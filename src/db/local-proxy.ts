import { neonConfig } from "@neondatabase/serverless";

/**
 * Points the Neon serverless driver (HTTP + WebSocket/Pool transports) at a local proxy
 * (ghcr.io/timowilhelm/local-neon-http-proxy, run as a Docker sidecar — see deploy notes
 * in CLAUDE.md) instead of Neon's own cloud data-proxy, now that this app runs against a
 * self-hosted Postgres on the same VPS rather than Neon. Without this, `neon()` builds a
 * fetch URL from the DATABASE_URL host (e.g. `https://localhost/sql`) that nothing serves,
 * and `Pool` tries to open a WebSocket to Neon's cloud infrastructure — both fail outright
 * against a plain self-hosted Postgres.
 *
 * Gated on DB_LOCAL_PROXY_URL so a real Neon-hosted deployment (no proxy, no env var set)
 * keeps the driver's normal Neon-cloud behavior untouched.
 *
 * Imported for its side effect only — every module that constructs a `neon()`/`Pool`
 * client must import this first (src/db/client.ts and src/app/api/health/route.ts).
 */
const proxyUrl = process.env.DB_LOCAL_PROXY_URL;
if (proxyUrl) {
  const { hostname, port } = new URL(proxyUrl);
  neonConfig.fetchEndpoint = `http://${hostname}:${port}/sql`;
  neonConfig.wsProxy = () => `${hostname}:${port}/v1`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
}
