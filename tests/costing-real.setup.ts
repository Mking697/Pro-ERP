import * as sdk from "@neondatabase/serverless";
if (process.env.PRO_ERP_COSTING_REAL !== "1") throw new Error("Use the disposable costing runner with explicit opt-in");
const host = process.env.PRO_ERP_COSTING_DB_HOST ?? "";
const binding = process.env.PRO_ERP_COSTING_WS ?? "";
const endpoint = process.env.PRO_ERP_COSTING_HTTP ?? "";
const connection = process.env.DATABASE_URL ?? "";
const url = new URL(connection);
if (!/^pro-erp-costing-qa-[0-9a-f]{12}-pg$/.test(host) || url.hostname !== host || url.port !== "5432" || url.pathname !== "/pro_erp_costing_qa" || url.username !== "pro_erp_costing_qa" || url.search !== "?sslmode=disable" || url.hash || !/^127\.0\.0\.1:\d+$/.test(binding) || !/^http:\/\/127\.0\.0\.1:\d+\/sql$/.test(endpoint) || process.env.DB_LOCAL_PROXY_URL) throw new Error("Unsafe costing DB target");
sdk.neonConfig.wsProxy = (destination, port) => { if (destination !== host || String(port) !== "5432") throw new Error("Unsafe WS target"); return `${binding}/v1?address=${host}:5432`; };
sdk.neonConfig.webSocketConstructor = WebSocket;
sdk.neonConfig.useSecureWebSocket = false;
sdk.neonConfig.pipelineConnect = false;
sdk.neonConfig.poolQueryViaFetch = false;
sdk.neonConfig.fetchEndpoint = () => endpoint;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const target = new URL(headers.get("neon-connection-string") ?? "about:blank");
  // Installed SDK appends application_name; it does not change routing. Reject all
  // other deviations, including arbitrary query overrides, before local dispatch.
  target.searchParams.delete("application_name");
  if (requestUrl !== endpoint || target.href !== new URL(connection).href) throw new Error("External fetch blocked in costing test");
  headers.set("neon-connection-string", connection);
  return nativeFetch(input, { ...init, headers, redirect: "error" });
};
sdk.neonConfig.fetchFunction = globalThis.fetch;
const pool = new sdk.Pool({ connectionString: connection, connectionTimeoutMillis: 10000 });
try {
  const { rows } = await pool.query("select current_database() db, current_user usr");
  if (rows[0].db !== "pro_erp_costing_qa" || rows[0].usr !== "pro_erp_costing_qa") throw new Error("Unsafe actual Pool identity");
} finally { await pool.end(); }
const result = await sdk.neon(connection).query("select current_database() db, current_user usr");
if (result[0].db !== "pro_erp_costing_qa" || result[0].usr !== "pro_erp_costing_qa") throw new Error("Unsafe actual HTTP identity");
