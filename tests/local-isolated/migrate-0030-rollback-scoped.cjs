/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Rollback-scoped behavioral test for migration 0030 (DATA-06: items' identity moves
// from platform-wide `sku` alone to tenant-local composite (org_id, sku)) against the
// REAL, already-applied baseline-30 `public` schema on the guarded disposable
// PostgreSQL target. Follows exactly the SAVEPOINT/ROLLBACK-scoped real-PG technique
// established by migrate-0029-rollback-scoped.cjs — a single manually-driven
// transaction, savepoints around each sub-scenario so one scenario's expected failure
// doesn't abort the others, and a final ROLLBACK (never COMMIT) so the shared
// disposable database is provably bit-for-bit unchanged afterward.
//
// Why the "duplicate (org_id, sku)" preflight branch needs its own constraint drop:
// migration 0030's preflight is mathematically a defensive fail-closed check, not a
// response to a condition that can occur under the CURRENT (pre-migration) schema —
// the old `items_pkey` (sku alone, platform-wide unique) is strictly stricter than the
// new composite key, so no row satisfying the old constraint can ever violate the new
// one. To actually exercise the preflight's duplicate-detection branch for real, this
// test first drops the old constraint inside its own savepoint (simulating a
// hypothetically-already-corrupted state), inserts a synthetic same-org... same-sku
// duplicate, proves the preflight catches it and aborts before any DDL, then rolls back
// to the savepoint, restoring the original constraint and removing the fixture, before
// moving on to the real upgrade scenario.
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
    // total migration count — the total grows every time a later migration (0031, 0032,
    // ...) is checked in, while migration 0030 itself and its own expected starting point
    // (exactly 30 migrations applied — baseline 29 + 0029, BEFORE 0030 runs) never move.
    const { migration: migration0030 } = resolveMigrationByTagPrefix(migrationsFolder, '0030');
    assert.match(migration0030.sql.join('\n'), /items_org_id_sku_pk/);

    await client.query('BEGIN');

    const before = await client.query('select count(*)::int n from drizzle.__drizzle_migrations');
    assert.equal(before.rows[0].n, 30, 'expected exactly 30 migrations applied for real before this test runs');

    const pkBefore = await client.query(
      "select constraint_name, string_agg(column_name, ',' order by ordinal_position) cols from information_schema.key_column_usage where table_name = 'items' and constraint_name like '%_pk%' group by constraint_name"
    );
    assert.deepEqual(pkBefore.rows, [{ constraint_name: 'items_pkey', cols: 'sku' }], 'items must start on the OLD sku-only primary key');

    await client.query('SAVEPOINT fixtures');
    await client.query(
      `insert into organizations (id, org_name, slug, owner_email) values
       ('ORG-M0030-A', 'Test Org A', 'test-org-m0030-a-' || gen_random_uuid()::text, 'a@example.com'),
       ('ORG-M0030-B', 'Test Org B', 'test-org-m0030-b-' || gen_random_uuid()::text, 'b@example.com')`
    );

    // --- Scenario 1: preflight's duplicate-(org_id,sku) branch, exercised directly.
    // Cannot occur under the live OLD constraint (sku is still platform-wide unique at
    // this point), so this sub-scenario deliberately drops the old constraint first,
    // purely to prove the DO-block logic itself fires correctly and aborts before any
    // DDL — then rolls all of it back, including the dropped constraint.
    await client.query('SAVEPOINT preflight_duplicate_test');
    await client.query('ALTER TABLE items DROP CONSTRAINT items_pkey');
    await client.query(
      `insert into items (sku, org_id, item_name, created_by) values
       ('SKU-DUP', 'ORG-M0030-A', 'Widget A', 'test'),
       ('SKU-DUP', 'ORG-M0030-A', 'Widget A duplicate', 'test')`
    );
    let abortedAsExpected = false;
    try {
      for (const stmt of migration0030.sql) {
        await client.query(stmt);
      }
    } catch (err) {
      abortedAsExpected = /Migration 0030 preflight failed: duplicate/.test(err.message);
      if (!abortedAsExpected) throw err;
    }
    assert.ok(abortedAsExpected, 'migration 0030 must throw its own duplicate-preflight error, not something else, when a duplicate (org_id, sku) exists');
    await client.query('ROLLBACK TO SAVEPOINT preflight_duplicate_test');
    const pkAfterAbort = await client.query(
      "select constraint_name, string_agg(column_name, ',' order by ordinal_position) cols from information_schema.key_column_usage where table_name = 'items' and constraint_name like '%_pk%' group by constraint_name"
    );
    assert.deepEqual(pkAfterAbort.rows, [{ constraint_name: 'items_pkey', cols: 'sku' }], 'abort must leave the OLD sku-only primary key exactly as found');
    results.duplicatePreflightAbortsBeforeDDL = 'PASS';

    // --- Scenario 2: upgrade path with genuine mixed-tenant pre-existing data (distinct
    // SKUs across two orgs — the only shape possible under the still-live OLD
    // constraint), migration 0030 must succeed end-to-end.
    await client.query(
      `insert into items (sku, org_id, item_name, created_by) values
       ('SKU-A-1', 'ORG-M0030-A', 'Org A Widget', 'test'),
       ('SKU-B-1', 'ORG-M0030-B', 'Org B Widget', 'test')`
    );
    for (const stmt of migration0030.sql) {
      await client.query(stmt);
    }
    await client.query(
      'insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)',
      [migration0030.hash, migration0030.folderMillis]
    );
    const pkAfterUpgrade = await client.query(
      "select constraint_name, string_agg(column_name, ',' order by ordinal_position) cols from information_schema.key_column_usage where table_name = 'items' and constraint_name like '%_pk%' group by constraint_name"
    );
    assert.deepEqual(pkAfterUpgrade.rows, [{ constraint_name: 'items_org_id_sku_pk', cols: 'org_id,sku' }], 'upgrade must install the NEW composite (org_id, sku) primary key');
    const migcount = await client.query('select count(*)::int n from drizzle.__drizzle_migrations');
    assert.equal(migcount.rows[0].n, 31, 'migrations table must now show 31 applied');
    const preexistingStillThere = await client.query(
      `select count(*)::int n from items where (org_id, sku) in (('ORG-M0030-A','SKU-A-1'), ('ORG-M0030-B','SKU-B-1'))`
    );
    assert.equal(preexistingStillThere.rows[0].n, 2, 'pre-existing mixed-tenant rows must survive the upgrade completely untouched');
    results.upgradeWithExistingMixedTenantSkuData = 'PASS';

    // --- Scenario 3: the actual DATA-06 regression — same SKU, different tenants, now
    // succeeds; same SKU, same tenant, is still rejected by the new composite key.
    await client.query('SAVEPOINT regression_cross_tenant');
    await client.query(
      `insert into items (sku, org_id, item_name, created_by) values
       ('SKU-SHARED', 'ORG-M0030-A', 'Shared SKU, Org A copy', 'test'),
       ('SKU-SHARED', 'ORG-M0030-B', 'Shared SKU, Org B copy', 'test')`
    );
    const sharedRows = await client.query(`select org_id, sku from items where sku = 'SKU-SHARED' order by org_id`);
    assert.deepEqual(sharedRows.rows, [{ org_id: 'ORG-M0030-A', sku: 'SKU-SHARED' }, { org_id: 'ORG-M0030-B', sku: 'SKU-SHARED' }], 'the same SKU string must now be usable by two different organizations simultaneously');
    results.sameSkuDifferentTenantsSucceeds = 'PASS';

    await client.query('SAVEPOINT regression_same_tenant_duplicate');
    let sameTenantRejected = false;
    try {
      await client.query(
        `insert into items (sku, org_id, item_name, created_by) values ('SKU-SHARED', 'ORG-M0030-A', 'Same org, same sku again', 'test')`
      );
    } catch (err) {
      sameTenantRejected = /duplicate key value violates unique constraint "items_org_id_sku_pk"/.test(err.message);
      if (!sameTenantRejected) throw err;
    }
    assert.ok(sameTenantRejected, 'same org + same sku must still be rejected by the new composite primary key');
    await client.query('ROLLBACK TO SAVEPOINT regression_same_tenant_duplicate');
    results.sameTenantDuplicateStillRejected = 'PASS';

    // NOT NULL on org_id is unchanged by this migration — confirm it still holds under
    // the new composite key (a NULL column could never satisfy the new PK either).
    await client.query('SAVEPOINT regression_missing_org');
    let missingOrgRejected = false;
    try {
      await client.query(`insert into items (sku, org_id, item_name, created_by) values ('SKU-NO-ORG', NULL, 'No org', 'test')`);
    } catch (err) {
      missingOrgRejected = /null value in column "org_id"/.test(err.message);
      if (!missingOrgRejected) throw err;
    }
    assert.ok(missingOrgRejected, 'a missing org_id must still be rejected after the upgrade');
    await client.query('ROLLBACK TO SAVEPOINT regression_missing_org');
    results.missingOrgReferenceStillRejected = 'PASS';

    console.log(JSON.stringify(results, null, 2));
  } finally {
    // Never COMMIT. Whatever happened above (including the mid-test constraint
    // drop/restore), the real database is left exactly as it was found.
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

main().catch((err) => {
  console.error('Rollback-scoped migration 0030 behavior test failed (no credentials logged):', err.message);
  process.exitCode = 1;
});
