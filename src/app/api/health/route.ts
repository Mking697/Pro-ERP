import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getPlatformAdminEmails } from "@/lib/platform/admin";
import { expectedMigrationLineage } from "@/lib/expected-migration-lineage";

export const dynamic = "force-dynamic";

const DB_READINESS_TIMEOUT_MS = 2500;

type SchemaVersion = { hash: string; appliedAtMs: number } | null;

type ReadinessError = "DATABASE_NOT_CONFIGURED" | "DATABASE_UNAVAILABLE" | "DATABASE_TIMEOUT"
  | "SCHEMA_MISSING" | "SCHEMA_STALE" | "SCHEMA_DIVERGENT";
type DatabaseReadiness = {
  reachable: boolean;
  latencyMs: number;
  schemaVersion?: SchemaVersion;
  error?: ReadinessError;
};

type AppliedRow = { hash: string; created_at: string };

/**
 * Deliberately bypasses the app's shared drizzle `db` client (@/db/client) and talks
 * to `@neondatabase/serverless`'s `neon()` query function directly, for one specific
 * reason: it is the only layer in this stack whose `fetchOptions.signal` is actually
 * wired into the real outgoing `fetch()` call (confirmed by reading
 * node_modules/@neondatabase/serverless/index.js — fetchOptions is spread onto the
 * fetch() call options) and that fetch is the entire HTTP round-trip this driver makes
 * for a query. Drizzle's neon-http prepared-query (node_modules/drizzle-orm/neon-http/
 * session.js) hardcodes its own `{ arrayMode, fullResults }` options object and never
 * accepts or forwards a signal, so going through `db.execute()` cannot cancel anything
 * — only abandon waiting on it. Using `neon()` directly means a timeout here actually
 * aborts the in-flight request to Neon's HTTP data-proxy, not merely stops awaiting it.
 * (A query that reaches Postgres itself, past the proxy, may still finish server-side —
 * no HTTP-layer client can force Postgres to stop executing — but this is as close to
 * real cancellation as this transport provides, and is a genuine fetch abort, not a
 * cosmetic Promise.race.)
 *
 * Readiness requires exact ordered migration hash/timestamp identity with the packaged
 * build lineage, not reachability, count equality, or the latest row alone.
 */
async function checkDatabaseReadiness(connectionString: string): Promise<DatabaseReadiness> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let reachable = false;
  const controller = new AbortController();
  try {
    const sql = neon(connectionString);
    const probe = (async () => {
      await sql.query("select 1", [], { fetchOptions: { signal: controller.signal } });
      reachable = true;
      const rows = (await sql.query(
        "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id LIMIT $1",
        [expectedMigrationLineage.length + 1],
        { fetchOptions: { signal: controller.signal } },
      )) as AppliedRow[];
      const last = rows.at(-1);
      const knownVersion = last && expectedMigrationLineage.find(
        (m) => m.hash === last.hash && m.folderMillis === Number(last.created_at),
      );
      const divergent = rows.some((r, index) => {
        const expected = expectedMigrationLineage[index];
        return !expected || r.hash !== expected.hash || Number(r.created_at) !== expected.folderMillis;
      });
      return {
        schemaVersion: knownVersion ? { hash: knownVersion.hash, appliedAtMs: knownVersion.folderMillis } : null,
        appliedCount: rows.length,
        divergent,
      };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(); // real cancellation of the in-flight fetch, not just abandoning the wait
        reject(new Error("readiness timeout"));
      }, DB_READINESS_TIMEOUT_MS);
    });
    const { schemaVersion, appliedCount, divergent } = await Promise.race([probe, timeout]);
    return { reachable: true, latencyMs: Date.now() - started, schemaVersion,
      ...(appliedCount === 0 ? { error: "SCHEMA_MISSING" as const }
        : divergent ? { error: "SCHEMA_DIVERGENT" as const }
        : appliedCount < expectedMigrationLineage.length ? { error: "SCHEMA_STALE" as const } : {}) };
  } catch (error) {
    // Drizzle/Neon wrap driver errors in `cause`; classify codes, never publish messages.
    let missingMetadata = false;
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      const diagnostic = cause as { code?: unknown; cause?: unknown };
      if (diagnostic.code === "42P01" || diagnostic.code === "3F000") missingMetadata = true;
      cause = diagnostic.cause;
    }
    return {
      reachable,
      latencyMs: Date.now() - started,
      error: timedOut ? "DATABASE_TIMEOUT" : reachable && missingMetadata ? "SCHEMA_MISSING" : "DATABASE_UNAVAILABLE",
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Public liveness/build metadata plus fail-closed DB/schema readiness.
 * Never publishes driver diagnostics or secret values. Not a DR/restore proof.
 */
export async function GET() {
  const connectionString = process.env.DATABASE_URL;
  const database: DatabaseReadiness = connectionString
    ? await checkDatabaseReadiness(connectionString)
    : { reachable: false, latencyMs: 0, error: "DATABASE_NOT_CONFIGURED" };

  const ready = database.reachable && !database.error;

  return NextResponse.json(
    {
      status: "ok",
      ready,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
      environment: process.env.VERCEL_ENV ?? "development",
      time: new Date().toISOString(),
      database,
      configured: {
        database: Boolean(connectionString),
        jwtSecret: Boolean(process.env.JWT_SECRET),
        cronSecret: Boolean(process.env.CRON_SECRET),
        fileStorage: Boolean(process.env.UPLOADS_DIR),
        // Count only — the addresses themselves stay out of a public endpoint.
        platformAdmins: getPlatformAdminEmails().length,
      },
    },
    { status: ready ? 200 : 503 }
  );
}
