import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { tenantUsageMetrics } from "@/db/schema";
import { todayIST } from "@/lib/dateUtil";
import { forEachActiveOrganization, type OrgRunResult } from "@/lib/platform/runner";

/**
 * Per-tenant usage measurement — the shared-schema architecture has no native per-tenant
 * bill (Neon bills this whole database's total compute-hours and storage-GB, with no
 * concept of "tenant"), so this approximates a storage share and a request share per org.
 * See CLAUDE.md's "Scoped and approved — Paid plan tiers + a per-tenant AI Chatbot" section
 * for the full reasoning; this file is the implementation of its "Per-tenant usage
 * measurement" bullet.
 */

// Tables that carry an org_id column but are NOT tenant-owned business data (see their own
// schema-file comments in src/db/schema/platform.ts) — excluded here the same way
// deleteOrganization()'s cascade excludes them from tenant-data operations.
const NOT_TENANT_OWNED = new Set(["error_logs", "rate_limit_hits", "tenant_usage_metrics"]);

/**
 * Every tenant-scoped table, found by reflection over the schema module rather than a
 * second hand-maintained list — `deleteOrganization()` (src/lib/platform/registry.ts) has
 * its own explicit list for the same "every table with org_id" concept, and CLAUDE.md's own
 * working notes warn hand-duplicating a list like that is exactly how it drifts out of sync.
 * Reflection means a future table with an `orgId` column is picked up here automatically,
 * with no second edit required.
 */
function tenantScopedTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableName(value);
    if (NOT_TENANT_OWNED.has(name)) continue;
    const columns = getTableColumns(value) as Record<string, unknown>;
    if ("orgId" in columns) tables.push(value);
  }
  return tables;
}

interface StorageShare {
  rowCount: number;
  bytesEstimate: number;
}

/**
 * The expensive cross-org aggregation — one pass per tenant table (not one pass per org
 * per table), computed ONCE per cron run. `pg_class`'s own live statistics give an avg
 * bytes-per-row for a table without scanning it; the actual per-org row counts still need
 * a real `GROUP BY org_id` over each table, but that's still one query per table, not one
 * per (table, org) pair.
 */
async function computeStorageShares(): Promise<Map<string, StorageShare>> {
  const shares = new Map<string, StorageShare>();

  for (const table of tenantScopedTables()) {
    const name = getTableName(table);
    const columns = getTableColumns(table) as Record<string, { name: string }>;
    const orgIdCol = columns.orgId;

    // db.execute() on a bare `sql` query (no `fields`/select-builder mapper) resolves to
    // the driver's raw QueryResult shape — { rows, rowCount, ... } — not a plain array.
    const sizeResult = await db.execute<{ avg_row_bytes: number | string | null }>(sql`
      SELECT
        CASE WHEN reltuples > 0 THEN pg_total_relation_size(oid)::float8 / reltuples ELSE 0 END AS avg_row_bytes
      FROM pg_class WHERE relname = ${name} AND relkind = 'r'
    `);
    const avgRowBytes = Number(sizeResult.rows[0]?.avg_row_bytes ?? 0);

    const countResult = await db.execute<{ org_id: string; row_count: number | string }>(sql`
      SELECT ${sql.identifier(orgIdCol.name)} AS org_id, COUNT(*)::bigint AS row_count
      FROM ${table}
      GROUP BY ${sql.identifier(orgIdCol.name)}
    `);

    for (const row of countResult.rows) {
      const rowCount = Number(row.row_count);
      const existing = shares.get(row.org_id) ?? { rowCount: 0, bytesEstimate: 0 };
      existing.rowCount += rowCount;
      existing.bytesEstimate += rowCount * avgRowBytes;
      shares.set(row.org_id, existing);
    }
  }

  return shares;
}

/**
 * Best-effort request counter — called from `src/proxy.ts` via `event.waitUntil()` on
 * every authenticated request, mirroring `src/lib/rateLimit.ts`'s own Postgres-backed
 * fixed-window counter shape (no in-memory state, since Vercel's serverless functions share
 * no memory between instances). Never throws — a usage-tracking failure must never affect
 * the actual request it's measuring.
 */
export async function recordTenantRequest(orgId: string): Promise<void> {
  try {
    const metricDate = todayIST();
    const id = `${orgId}:${metricDate}`;
    await db
      .insert(tenantUsageMetrics)
      .values({ id, orgId, metricDate, requestCount: 1 })
      .onConflictDoUpdate({
        target: tenantUsageMetrics.id,
        set: {
          requestCount: sql`${tenantUsageMetrics.requestCount} + 1`,
          updatedAt: sql`now()`,
        },
      });
  } catch {
    // Best-effort by design — see the doc comment above.
  }
}

/**
 * The daily cron job: computes today's storage share once across every org, then writes
 * each org's own slice via `forEachActiveOrganization()` (for the same per-org error
 * isolation every other daily job gets) — deliberately NOT calling this cross-org
 * aggregation once per org, which is what naively nesting it inside the existing
 * `runDailyJobs()` per-org loop would do. `requestCount` is intentionally left untouched on
 * conflict — it accumulates all day from `recordTenantRequest()`, and this job only ever
 * updates the storage columns.
 */
export async function computeTenantUsageMetrics(): Promise<OrgRunResult<StorageShare>[]> {
  const shares = await computeStorageShares();
  const metricDate = todayIST();

  return forEachActiveOrganization(async (ctx) => {
    const share = shares.get(ctx.orgId) ?? { rowCount: 0, bytesEstimate: 0 };
    const id = `${ctx.orgId}:${metricDate}`;

    await db
      .insert(tenantUsageMetrics)
      .values({
        id,
        orgId: ctx.orgId,
        metricDate,
        storageRowCount: share.rowCount,
        storageBytesEstimate: String(share.bytesEstimate),
      })
      .onConflictDoUpdate({
        target: tenantUsageMetrics.id,
        set: {
          storageRowCount: share.rowCount,
          storageBytesEstimate: String(share.bytesEstimate),
          updatedAt: sql`now()`,
        },
      });

    return share;
  });
}
