/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Rollback-scoped behavioral test for migration 0031 (OPS-01: durable natural-cycle
// identity for the recurring-task generator — unique (org_id, recurring_id, due_date)
// for recurring occurrences, scoped to recurring_id <> '') against the REAL,
// already-applied baseline-30 `public` schema on the guarded disposable PostgreSQL
// target. Follows exactly the SAVEPOINT/ROLLBACK-scoped real-PG technique established by
// migrate-0029/0030-rollback-scoped.cjs — a single manually-driven transaction,
// savepoints around each sub-scenario so one scenario's expected failure doesn't abort
// the others, and a final ROLLBACK (never COMMIT) so the shared disposable database is
// provably bit-for-bit unchanged afterward.
const assert = require('node:assert/strict');
const path = require('node:path');
const sdk = require('@neondatabase/serverless');
const { root, loadCredentials, configureSDK, verifyPool, resolveMigrationByTagPrefix } = require('./runtime.cjs');

async function main() {
  const credentials = loadCredentials();
  configureSDK(sdk, credentials);
  const client = new sdk.Client({ connectionString: credentials.connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();
  const results = {};
  try {
    const target = await verifyPool(client);
    results.target = target;

    const migrationsFolder = path.join(root, 'drizzle');
    // Resolved against the REAL current drizzle/meta/_journal.json, not a hardcoded
    // total migration count — the total grows every time a later migration (0032, ...)
    // is checked in, while migration 0031 itself and its own expected starting point
    // (exactly 30 migrations applied — baseline 29 + 0029, BEFORE 0030/0031 run) never
    // move. This test is scoped exactly like migrate-0030-rollback-scoped.cjs: it exercises
    // 0031 alone, against the same pre-0030 baseline (0031 touches `tasks`, not `items`,
    // so it has no real dependency on 0030 having run first in this isolated scope).
    const { migration: migration0031 } = resolveMigrationByTagPrefix(migrationsFolder, '0031');
    assert.match(migration0031.sql.join('\n'), /tasks_org_id_recurring_id_due_date_unique/);

    await client.query('BEGIN');

    const before = await client.query('select count(*)::int n from drizzle.__drizzle_migrations');
    assert.equal(before.rows[0].n, 30, 'expected exactly 30 migrations applied for real before this test runs');

    const idxBefore = await client.query(
      "select indexname from pg_indexes where tablename = 'tasks' and indexname = 'tasks_org_id_recurring_id_due_date_unique'"
    );
    assert.deepEqual(idxBefore.rows, [], 'the new unique index must not exist yet');

    await client.query('SAVEPOINT fixtures');
    await client.query(
      `insert into organizations (id, org_name, slug, owner_email) values
       ('ORG-M0031-A', 'Test Org A', 'test-org-m0031-a-' || gen_random_uuid()::text, 'a@example.com')`
    );

    // --- Scenario 1: preflight's duplicate-(org_id, recurring_id, due_date) branch,
    // exercised with a genuine pre-existing duplicate — unlike 0030's provably-impossible
    // case, this one can really happen under concurrency before this item's generator fix.
    await client.query('SAVEPOINT preflight_duplicate_test');
    await client.query(
      `insert into tasks (id, org_id, title, assigned_to, assigned_by, task_type, due_date, status, recurring_id) values
       ('TSK-M0031-DUP-1', 'ORG-M0031-A', 'Daily cycle', 'USR-1', 'USR-1', 'Recurring', '2026-10-09T23:59:00Z', 'Pending', 'RCR-DUP'),
       ('TSK-M0031-DUP-2', 'ORG-M0031-A', 'Daily cycle (duplicate)', 'USR-1', 'USR-1', 'Recurring', '2026-10-09T23:59:00Z', 'Pending', 'RCR-DUP')`
    );
    let abortedAsExpected = false;
    try {
      for (const stmt of migration0031.sql) {
        await client.query(stmt);
      }
    } catch (err) {
      abortedAsExpected = /Migration 0031 preflight failed: duplicate/.test(err.message);
      if (!abortedAsExpected) throw err;
    }
    assert.ok(abortedAsExpected, 'migration 0031 must throw its own duplicate-preflight error, not something else, when a duplicate (org_id, recurring_id, due_date) exists');
    await client.query('ROLLBACK TO SAVEPOINT preflight_duplicate_test');
    const idxAfterAbort = await client.query(
      "select indexname from pg_indexes where tablename = 'tasks' and indexname = 'tasks_org_id_recurring_id_due_date_unique'"
    );
    assert.deepEqual(idxAfterAbort.rows, [], 'abort must leave the schema with no new index at all');
    results.duplicatePreflightAbortsBeforeDDL = 'PASS';

    // --- Scenario 2: upgrade path with genuine pre-existing data that does NOT violate
    // the new invariant (distinct cycles, a one-off task with a blank recurring_id, and
    // two different orgs sharing a recurring_id+due_date — never constrained together).
    await client.query(
      `insert into organizations (id, org_name, slug, owner_email) values
       ('ORG-M0031-B', 'Test Org B', 'test-org-m0031-b-' || gen_random_uuid()::text, 'b@example.com')`
    );
    await client.query(
      `insert into tasks (id, org_id, title, assigned_to, assigned_by, task_type, due_date, status, recurring_id) values
       ('TSK-M0031-ONEOFF', 'ORG-M0031-A', 'One-off task', 'USR-1', 'USR-1', 'One-Time', '2026-10-09T23:59:00Z', 'Pending', ''),
       ('TSK-M0031-ONEOFF-2', 'ORG-M0031-A', 'Another one-off, same instant', 'USR-1', 'USR-1', 'One-Time', '2026-10-09T23:59:00Z', 'Pending', ''),
       ('TSK-M0031-A1', 'ORG-M0031-A', 'Weekly cycle', 'USR-1', 'USR-1', 'Recurring', '2026-10-09T23:59:00Z', 'Pending', 'RCR-A'),
       ('TSK-M0031-B1', 'ORG-M0031-B', 'Weekly cycle, other org, same rule-id text and due date', 'USR-2', 'USR-2', 'Recurring', '2026-10-09T23:59:00Z', 'Pending', 'RCR-A')`
    );
    for (const stmt of migration0031.sql) {
      await client.query(stmt);
    }
    await client.query(
      'insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)',
      [migration0031.hash, migration0031.folderMillis]
    );
    const idxAfterUpgrade = await client.query(
      "select indexdef from pg_indexes where tablename = 'tasks' and indexname = 'tasks_org_id_recurring_id_due_date_unique'"
    );
    assert.equal(idxAfterUpgrade.rows.length, 1, 'upgrade must install the new unique index');
    assert.match(idxAfterUpgrade.rows[0].indexdef, /recurring_id"? <> ''::text/, 'index must be partial, scoped to recurring_id <> \'\'');
    const migcount = await client.query('select count(*)::int n from drizzle.__drizzle_migrations');
    assert.equal(migcount.rows[0].n, 31, 'migrations table must now show 31 applied');
    const preexistingStillThere = await client.query(
      `select count(*)::int n from tasks where id in ('TSK-M0031-ONEOFF', 'TSK-M0031-ONEOFF-2', 'TSK-M0031-A1', 'TSK-M0031-B1')`
    );
    assert.equal(preexistingStillThere.rows[0].n, 4, 'pre-existing non-violating rows must survive the upgrade completely untouched');
    results.upgradeWithNonViolatingExistingDataSucceeds = 'PASS';

    // --- Scenario 3: the actual OPS-01 regression — a second insert for the same
    // (org, recurring rule, cycle due date), simulating a concurrent/retried cron run's
    // second write landing after the first already committed, is now rejected by the DB
    // itself rather than depending solely on the generator's own read-before-insert check.
    await client.query('SAVEPOINT regression_duplicate_cycle');
    let duplicateCycleRejected = false;
    try {
      await client.query(
        `insert into tasks (id, org_id, title, assigned_to, assigned_by, task_type, due_date, status, recurring_id) values
         ('TSK-M0031-A1-RETRY', 'ORG-M0031-A', 'Weekly cycle (retry)', 'USR-1', 'USR-1', 'Recurring', '2026-10-09T23:59:00Z', 'Pending', 'RCR-A')`
      );
    } catch (err) {
      duplicateCycleRejected = /duplicate key value violates unique constraint "tasks_org_id_recurring_id_due_date_unique"/.test(err.message);
      if (!duplicateCycleRejected) throw err;
    }
    assert.ok(duplicateCycleRejected, 'a second occurrence for the same (org, recurring_id, due_date) cycle must still be rejected after the upgrade');
    await client.query('ROLLBACK TO SAVEPOINT regression_duplicate_cycle');
    results.concurrentRetryDuplicateCycleStillRejected = 'PASS';

    // One-off tasks (blank recurring_id) remain completely unconstrained by this index —
    // any number of them may share the exact same org_id + due_date.
    await client.query('SAVEPOINT regression_oneoff_unconstrained');
    await client.query(
      `insert into tasks (id, org_id, title, assigned_to, assigned_by, task_type, due_date, status, recurring_id) values
       ('TSK-M0031-ONEOFF-3', 'ORG-M0031-A', 'Yet another one-off, same instant', 'USR-1', 'USR-1', 'One-Time', '2026-10-09T23:59:00Z', 'Pending', '')`
    );
    results.oneOffTasksRemainUnconstrained = 'PASS';
    await client.query('ROLLBACK TO SAVEPOINT regression_oneoff_unconstrained');

    console.log(JSON.stringify(results, null, 2));
  } finally {
    // Never COMMIT. Whatever happened above, the real database is left exactly as it was found.
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error('Rollback-scoped migration 0031 behavior test failed (no credentials logged):', err.message);
  process.exitCode = 1;
});
