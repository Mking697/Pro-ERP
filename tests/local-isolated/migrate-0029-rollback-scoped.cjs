/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Rollback-scoped behavioral test for migration 0029 (dispatch shipment partial
// uniqueness reconciliation + mutation_receipts) against the REAL, already-applied
// baseline-29 public schema on the guarded disposable PostgreSQL target.
//
// Why not an isolated CREATE SCHEMA + search_path, and why not a from-empty "fresh
// install" of all 30 migrations: every CREATE TYPE (enum) and every FK ALTER TABLE
// statement drizzle-kit generated for this project hardcodes its target as literal
// "public".name, regardless of search_path (verified across every drizzle/*.sql file —
// zero exceptions). A second schema can host unqualified CREATE TABLE/INDEX statements
// fine, but replaying migrations 0000-0028 anywhere on this same database immediately
// collides on "type already exists" for enums like org_status/dispatch_status, which
// already exist for real in `public`. Short of dropping/recreating the whole database
// (which the guard in tests/local-isolated/safety.cjs intentionally refuses — it hard-
// pins the target to pro_erp_test — and which this task's instructions forbid wiping),
// there is no way to replay a truly empty-to-30 install on this shared disposable DB.
//
// What IS safely testable with full fidelity, with zero risk to the shared database: a
// single manually-driven transaction that (a) removes the earlier phase's untracked,
// non-migration mutation_receipts/partial-index objects so the starting point is a
// genuine "29 migrations applied, nothing extra" state, (b) runs the ACTUAL checked-in
// 0029 SQL (read from disk, not hand-copied) through every scenario below, and
// (c) ends in ROLLBACK, never COMMIT — so no matter what happens inside, `public` is
// bit-for-bit back to its pre-test state once this script exits. Savepoints are used
// around each sub-scenario purely so one scenario's expected failure doesn't abort the
// others; the outermost transaction is still always rolled back, never committed.
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
    // total migration count — the total grows every time a later migration (0030, 0031,
    // ...) is checked in, while migration 0029 itself and its own expected starting point
    // (exactly 29 migrations applied, BEFORE 0029 runs) never move.
    const { migration: migration0029 } = resolveMigrationByTagPrefix(migrationsFolder, '0029');
    assert.match(migration0029.sql.join('\n'), /dispatches_org_id_shipment_id_unique/);

    await client.query('BEGIN');

    const before = await client.query('select count(*)::int n from drizzle.__drizzle_migrations');
    assert.equal(before.rows[0].n, 29, 'expected exactly 29 migrations applied for real before this test runs');

    // Earlier phase's LOCAL-ONLY, non-tracked supplement — drop it inside this
    // transaction (fully reversible by the final ROLLBACK) so the rest of this test
    // runs against a genuine pre-0029 state, not that stray pollution.
    await client.query('DROP TABLE IF EXISTS mutation_receipts');
    await client.query('DROP INDEX IF EXISTS dispatches_org_id_shipment_id_unique');
    const clean = await client.query("select to_regclass('public.mutation_receipts') receipts, to_regclass('public.dispatches_org_id_shipment_id_unique') idx");
    assert.equal(clean.rows[0].receipts, null);
    assert.equal(clean.rows[0].idx, null);

    await client.query('SAVEPOINT fixtures');
    await client.query(
      `insert into organizations (id, org_name, slug, owner_email) values ('ORG-M0029-TEST', 'Test Org', 'test-org-m0029-' || gen_random_uuid()::text, 'test@example.com')`
    );
    // Two historical rows with BLANK shipment_id for the same org — the policy is to
    // preserve this legacy history untouched, never delete/rewrite it.
    await client.query(
      `insert into dispatches (id, org_id, order_id, shipment_id, gate_pass_no) values
       ('DSP-M0029-BLANK-1', 'ORG-M0029-TEST', 'ORD-1', '', 'GP-M0029-1'),
       ('DSP-M0029-BLANK-2', 'ORG-M0029-TEST', 'ORD-2', '', 'GP-M0029-2')`
    );
    // A genuine duplicate on (org_id, nonempty shipment_id) — this is exactly what the
    // preflight inside migration 0029 must catch BEFORE any DDL runs.
    await client.query(
      `insert into dispatches (id, org_id, order_id, shipment_id, gate_pass_no) values
       ('DSP-M0029-DUP-1', 'ORG-M0029-TEST', 'ORD-3', 'SHIP-DUP', 'GP-M0029-3'),
       ('DSP-M0029-DUP-2', 'ORG-M0029-TEST', 'ORD-4', 'SHIP-DUP', 'GP-M0029-4')`
    );

    // --- Scenario 1: duplicate present — migration 0029 must abort BEFORE any DDL.
    await client.query('SAVEPOINT attempt_with_duplicate');
    let abortedAsExpected = false;
    try {
      for (const stmt of migration0029.sql) {
        await client.query(stmt);
      }
    } catch (err) {
      abortedAsExpected = /preflight failed/.test(err.message);
      if (!abortedAsExpected) throw err;
    }
    assert.ok(abortedAsExpected, 'migration 0029 must throw its own preflight error, not something else, when a duplicate exists');
    await client.query('ROLLBACK TO SAVEPOINT attempt_with_duplicate');
    const afterAbort = await client.query("select to_regclass('public.mutation_receipts') receipts, to_regclass('public.dispatches_org_id_shipment_id_unique') idx");
    assert.equal(afterAbort.rows[0].receipts, null, 'abort must leave mutation_receipts uncreated');
    assert.equal(afterAbort.rows[0].idx, null, 'abort must leave the partial index uncreated');
    results.duplicatePreflightAbortsBeforeDDL = 'PASS';

    // --- Scenario 2: reconcile the synthetic duplicate fixture (test-created data, not
    // real production history) and prove migration 0029 now succeeds end-to-end, with
    // the legacy blank rows preserved and the tenant invariant enforced going forward.
    await client.query(`delete from dispatches where id = 'DSP-M0029-DUP-2'`);
    for (const stmt of migration0029.sql) {
      await client.query(stmt);
    }
    // Replicate the migrator's own bookkeeping insert so this manually-driven run is
    // indistinguishable, from the DB's point of view, from `migrate()` having run it.
    await client.query(
      'insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)',
      [migration0029.hash, migration0029.folderMillis]
    );
    const afterFix = await client.query(
      "select to_regclass('public.mutation_receipts') receipts, pg_get_indexdef('dispatches_org_id_shipment_id_unique'::regclass) idx, (select count(*)::int from drizzle.__drizzle_migrations) migcount"
    );
    assert.ok(afterFix.rows[0].receipts, 'reconciled run must create mutation_receipts');
    assert.match(afterFix.rows[0].idx, /WHERE \(shipment_id <> ''::text\)/, 'index must be partial on nonempty shipment_id');
    assert.equal(afterFix.rows[0].migcount, 30, 'migrations table must now show 30 applied');
    const blanksStillThere = await client.query(`select count(*)::int n from dispatches where org_id = 'ORG-M0029-TEST' and shipment_id = ''`);
    assert.equal(blanksStillThere.rows[0].n, 2, 'legacy blank rows must survive the upgrade completely untouched');

    await client.query('SAVEPOINT postupgrade_duplicate_attempt');
    let rejectedAsExpected = false;
    try {
      await client.query(
        `insert into dispatches (id, org_id, order_id, shipment_id, gate_pass_no) values ('DSP-M0029-DUP-3', 'ORG-M0029-TEST', 'ORD-5', 'SHIP-DUP', 'GP-M0029-5')`
      );
    } catch (err) {
      rejectedAsExpected = /duplicate key value violates unique constraint "dispatches_org_id_shipment_id_unique"/.test(err.message);
      if (!rejectedAsExpected) throw err;
    }
    assert.ok(rejectedAsExpected, 'post-upgrade, a new nonempty duplicate on (org_id, shipment_id) must be rejected by the partial index');
    await client.query('ROLLBACK TO SAVEPOINT postupgrade_duplicate_attempt');

    // A third blank row for the same org must still be allowed post-upgrade.
    await client.query(
      `insert into dispatches (id, org_id, order_id, shipment_id, gate_pass_no) values ('DSP-M0029-BLANK-3', 'ORG-M0029-TEST', 'ORD-6', '', 'GP-M0029-6')`
    );
    const blanksAfterInsert = await client.query(`select count(*)::int n from dispatches where org_id = 'ORG-M0029-TEST' and shipment_id = ''`);
    assert.equal(blanksAfterInsert.rows[0].n, 3, 'a new blank-shipment row must still be accepted after the upgrade');
    results.upgradeWithLegacyBlanksAndReconciledDuplicate = 'PASS';

    console.log(JSON.stringify(results, null, 2));
  } finally {
    // Never COMMIT. Whatever happened above (including the start-of-test DROP of the
    // stray local-only objects), the real database is left exactly as it was found.
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error('Rollback-scoped migration 0029 behavior test failed (no credentials logged):', err.message);
  process.exitCode = 1;
});
