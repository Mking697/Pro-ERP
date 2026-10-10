/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
const fs = require('node:fs');
const path = require('node:path');
const { validateEnvironment, validateConnection } = require('./safety.cjs');
const root = path.resolve(__dirname, '../..');
const label = 'pro-erp-local-tests-2026-10-09';
function loadCredentials() {
  const file = path.resolve(validateEnvironment());
  if (file.startsWith(root + path.sep)) throw new Error('Credentials must live outside the repository in scratch');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.label !== label) throw new Error('Unexpected disposable resource label');
  validateConnection(data.connectionString);
  return data;
}
function configureSDK(sdk, credentials) {
  const { neonConfig } = sdk;
  neonConfig.fetchEndpoint = () => 'http://127.0.0.1:55008/sql';
  neonConfig.wsProxy = (host, port) => {
    if (host !== 'pro-erp-regression-pg' || String(port) !== '5432') throw new Error('Non-disposable WebSocket destination blocked');
    return `127.0.0.1:55007/v1?address=${host}:${port}`;
  };
  neonConfig.webSocketConstructor = WebSocket;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  neonConfig.poolQueryViaFetch = false;
  // Keep the test-facing URL nonsecret (legacy guards assert this exact target).
  // Pool resolves its password from fresh PGPASSWORD; HTTP credentials are added
  // only by the guarded local fetch wrapper, never exposed in test assertions.
  const url = validateConnection(credentials.connectionString);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  url.password = '';
  process.env.DATABASE_URL = url.href;
}
async function verifyPool(pool) {
  const { rows } = await pool.query('select current_database() as database, current_user as username');
  if (rows[0].database !== 'pro_erp_test' || rows[0].username !== 'pro_erp_test') throw new Error('Unsafe actual PostgreSQL target');
  return rows[0];
}
/**
 * Resolves one specific checked-in migration by its numeric tag prefix (e.g. '0030'),
 * reading the REAL current drizzle/meta/_journal.json instead of a hardcoded total
 * migration count — the journal is the actual source of truth for how many migrations
 * exist and where each one sits, and it grows every time a new migration is checked in
 * (31 -> 32 when 0031 was added, etc). A rollback-scoped test for one numbered migration
 * must keep working as later migrations are added; hardcoding "allMigrations.length must
 * be exactly N" breaks the moment the Nth+1 migration lands, even though the migration
 * this test actually exercises hasn't moved.
 */
function resolveMigrationByTagPrefix(migrationsFolder, tagPrefix) {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const matches = journal.entries.filter((entry) => entry.tag.startsWith(`${tagPrefix}_`));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one journal entry tagged "${tagPrefix}_*", found ${matches.length}`);
  }
  const [entry] = matches;
  const { readMigrationFiles } = require('drizzle-orm/migrator');
  const allMigrations = readMigrationFiles({ migrationsFolder });
  if (allMigrations.length !== journal.entries.length) {
    throw new Error(
      `readMigrationFiles() returned ${allMigrations.length} migrations but the journal lists ${journal.entries.length} — they must stay in lockstep`
    );
  }
  return { migration: allMigrations[entry.idx], idx: entry.idx, totalMigrations: allMigrations.length, entry };
}
module.exports = { root, label, loadCredentials, configureSDK, verifyPool, resolveMigrationByTagPrefix };
