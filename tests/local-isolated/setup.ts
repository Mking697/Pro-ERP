import { randomBytes } from 'node:crypto';
import * as sdk from '@neondatabase/serverless';
import runtime from './runtime.cjs';
import safety from './safety.cjs';
// Never import dotenv/default setup. Gate before reading our fresh scratch credentials.
const credentials = runtime.loadCredentials();
runtime.configureSDK(sdk, credentials);
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.BLOB_READ_WRITE_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.CHATXFLOW_API_TOKEN = '';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href !== 'http://127.0.0.1:55008/sql') throw new Error('External test fetch/notification blocked');
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const target = safety.validateConnection(headers.get('neon-connection-string'), process.env.DATABASE_URL!);
  target.password = new URL(credentials.connectionString).password;
  headers.set('neon-connection-string', target.href);
  return nativeFetch(input, { ...init, headers, redirect: 'error' });
};
sdk.neonConfig.fetchFunction = globalThis.fetch;
const pool = new sdk.Pool({ connectionString: credentials.connectionString, connectionTimeoutMillis: 10000 });
try { await runtime.verifyPool(pool); } finally { await pool.end(); }
const sql = sdk.neon(process.env.DATABASE_URL!);
const rows = await sql.query('select current_database() as database, current_user as username');
if (rows[0].database !== 'pro_erp_test' || rows[0].username !== 'pro_erp_test') throw new Error('Unsafe actual Neon HTTP target');
