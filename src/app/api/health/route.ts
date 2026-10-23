import { NextResponse } from "next/server";
import { Pool } from "pg";
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
 * Deliberately bypasses the app's shared drizzle `db` client (@/db/client) and opens its
 * own dedicated single-connection pool, for one specific reason: `statement_timeout` is
 * set on THIS connection only (via `pg`'s own config, which issues `SET statement_timeout`
 * right after connecting), so a slow/hung query is cancelled by Postgres itself server-side
 * — real cancellation, not merely abandoning a client-side wait. (This is a genuine
 * improvement over the previous Neon-HTTP-driver implementation, which could only abort
 * the outgoing fetch and explicitly could NOT stop a query that had already reached
 * Postgres — here it can, because it talks to Postgres directly over its own protocol,
 * not through an intermediary HTTP data-proxy.) `connectionTimeoutMillis` separately
 * bounds how long we wait to even obtain a connection (e.g. database down / pool full).
 *
 * Readiness requires exact ordered migration hash/timestamp identity with the packaged
 * build lineage, not reachability, count equality, or the latest row alone.
 */
async function checkDatabaseReadiness(connectionString: string): Promise<DatabaseReadiness> {
  const started = Date.now();
  let timedOut = false;
  let reachable = false;
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: DB_READINESS_TIMEOUT_MS,
    statement_timeout: DB_READINESS_TIMEOUT_MS,
    query_timeout: DB_READINESS_TIMEOUT_MS,
  });
  try {
    await pool.query("select 1");
    reachable = true;
    const { rows } = await pool.query<AppliedRow>(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id LIMIT $1",
      [expectedMigrationLineage.length + 1],
    );
    const last = rows.at(-1);
    const knownVersion = last && expectedMigrationLineage.find(
      (m) => m.hash === last.hash && m.folderMillis === Number(last.created_at),
    );
    const divergent = rows.some((r, index) => {
      const expected = expectedMigrationLineage[index];
      return !expected || r.hash !== expected.hash || Number(r.created_at) !== expected.folderMillis;
    });
    const schemaVersion = knownVersion ? { hash: knownVersion.hash, appliedAtMs: knownVersion.folderMillis } : null;
    const appliedCount = rows.length;
    return { reachable: true, latencyMs: Date.now() - started, schemaVersion,
      ...(appliedCount === 0 ? { error: "SCHEMA_MISSING" as const }
        : divergent ? { error: "SCHEMA_DIVERGENT" as const }
        : appliedCount < expectedMigrationLineage.length ? { error: "SCHEMA_STALE" as const } : {}) };
  } catch (error) {
    // node-postgres surfaces a timed-out statement/connection as its own typed error.
    let missingMetadata = false;
    let cause: unknown = error;
    for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
      const diagnostic = cause as { code?: unknown; cause?: unknown; message?: unknown };
      if (diagnostic.code === "42P01" || diagnostic.code === "3F000") missingMetadata = true;
      if (diagnostic.code === "57014" || diagnostic.code === "ETIMEDOUT"
        || (typeof diagnostic.message === "string" && diagnostic.message.toLowerCase().includes("timeout"))) {
        timedOut = true;
      }
      cause = diagnostic.cause;
    }
    return {
      reachable,
      latencyMs: Date.now() - started,
      error: timedOut ? "DATABASE_TIMEOUT" : reachable && missingMetadata ? "SCHEMA_MISSING" : "DATABASE_UNAVAILABLE",
    };
  } finally {
    await pool.end().catch(() => {});
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
