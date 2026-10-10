/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Applies checked-in migrations only after actual Pool target verification.
const path = require('node:path');
const assert = require('node:assert/strict');
const sdk = require('@neondatabase/serverless');
const { drizzle } = require('drizzle-orm/neon-serverless');
const { migrate } = require('drizzle-orm/neon-serverless/migrator');
const { readMigrationFiles } = require('drizzle-orm/migrator');
const { root, loadCredentials, configureSDK, verifyPool } = require('./runtime.cjs');
const credentials = loadCredentials();
configureSDK(sdk, credentials);
const pool = new sdk.Pool({ connectionString: credentials.connectionString, connectionTimeoutMillis: 10000 });
(async () => {
  try {
    const target = await verifyPool(pool);
    const config = { migrationsFolder: path.join(root, 'drizzle') };
    const migrations = readMigrationFiles(config);
    assert.equal(migrations.length, 30, 'Expected exactly 30 checked-in migrations; review changed inventory before proceeding');
    await migrate(drizzle(pool), config);
    const { rows } = await pool.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at');
    assert.deepEqual(rows.map(r => ({ hash: r.hash, when: Number(r.created_at) })), migrations.map(m => ({ hash: m.hash, when: m.folderMillis })));
    // mutation_receipts and the dispatches(org_id,shipment_id) partial unique index are
    // now created by checked-in migration 0029 itself — nothing local-only left to add.
    const verified = await pool.query("select to_regclass('public.mutation_receipts') receipts, pg_get_indexdef('dispatches_org_id_shipment_id_unique'::regclass) dispatch_index");
    assert.equal(verified.rows[0].receipts, 'mutation_receipts');
    assert.match(verified.rows[0].dispatch_index, /UNIQUE INDEX/);
    assert.match(verified.rows[0].dispatch_index, /WHERE \(shipment_id <> ''::text\)/);
    console.log(JSON.stringify({ target, migrationsVerifiedByHashAndTimestamp: rows.length, dispatchIndex: verified.rows[0] }));
  } finally { await pool.end(); }
})().catch(() => { console.error('Disposable local migration or verification failed (no credentials logged)'); process.exitCode = 1; });
