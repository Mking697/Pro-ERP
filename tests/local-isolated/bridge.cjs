/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS infrastructure, not application modules. */
// Every response is real PostgreSQL, reached through the installed Neon Pool/WS driver.
const { createServer } = require('node:http');
const { Pool } = require('@neondatabase/serverless');
const sdk = require('@neondatabase/serverless');
const { loadCredentials, configureSDK, verifyPool } = require('./runtime.cjs');
const { validateConnection } = require('./safety.cjs');
const credentials = loadCredentials();
configureSDK(sdk, credentials);
const pool = new Pool({ connectionString: credentials.connectionString, max: 12, connectionTimeoutMillis: 10000 });
const levels = { ReadUncommitted: 'READ UNCOMMITTED', ReadCommitted: 'READ COMMITTED', RepeatableRead: 'REPEATABLE READ', Serializable: 'SERIALIZABLE' };
const rawTypes = { getTypeParser: () => value => value };
function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}
async function execute(client, query) {
  if (typeof query?.query !== 'string' || !Array.isArray(query.params)) throw new Error('Invalid query payload');
  const result = await client.query({ text: query.query, values: query.params, rowMode: 'array', types: rawTypes });
  return { command: result.command, rowCount: result.rowCount, fields: result.fields, rows: result.rows };
}
const server = createServer(async (request, response) => {
  let client;
  let begun = false;
  try {
    if (request.method === 'GET' && request.url === '/health') return send(response, 200, await verifyPool(pool));
    if (request.method !== 'POST' || request.url !== '/sql') return send(response, 404, { message: 'Not found' });
    validateConnection(request.headers['neon-connection-string'], credentials.connectionString);
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2000000) throw new Error('Payload too large');
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    client = await pool.connect();
    if (!Array.isArray(payload.queries)) return send(response, 200, await execute(client, payload));
    const level = request.headers['neon-batch-isolation-level'];
    if (level !== undefined && !levels[level]) throw new Error('Unsupported isolation level');
    const readOnly = request.headers['neon-batch-read-only'];
    const deferrable = request.headers['neon-batch-deferrable'];
    for (const option of [readOnly, deferrable]) if (option !== undefined && option !== 'true' && option !== 'false') throw new Error('Invalid transaction option');
    await client.query('BEGIN' + (level ? ' ISOLATION LEVEL ' + levels[level] : '') + (readOnly === 'true' ? ' READ ONLY' : '') + (deferrable === 'true' ? ' DEFERRABLE' : ''));
    begun = true;
    const results = [];
    for (const query of payload.queries) results.push(await execute(client, query));
    await client.query('COMMIT');
    begun = false;
    send(response, 200, { results });
  } catch (error) {
    if (begun && client) await client.query('ROLLBACK').catch(() => {});
    // Do not return SQL/values, credentials, or detailed errors to an unauthenticated client.
    send(response, 400, { message: 'Disposable local SQL request failed', code: error.code, constraint: error.constraint, schema: error.schema, table: error.table, column: error.column });
  } finally { client?.release(); }
});
(async () => {
  await verifyPool(pool);
  server.listen(55008, '127.0.0.1', () => console.log('LOCAL_SQL_BRIDGE_READY 127.0.0.1:55008 target=pro_erp_test pid=' + process.pid));
})().catch(() => { console.error('Disposable PostgreSQL readiness verification failed'); process.exitCode = 1; pool.end(); });
server.on('error', () => { console.error('Local bridge listener failed'); process.exitCode = 1; pool.end(); });
async function close() { server.close(); await pool.end(); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
