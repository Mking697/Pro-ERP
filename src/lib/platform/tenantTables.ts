import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * Tables that carry an org_id column but are NOT tenant-owned business data — diagnostic/
 * audit history (`error_logs`, `rate_limit_hits`) or a usage-measurement row itself
 * (`tenant_usage_metrics`) that is meaningless once the org it measured is gone. Excluded
 * here, and from `deleteOrganization()`'s cascade, and from `usageMetrics.ts`'s own
 * cross-org aggregation — see each schema file's own comment on these three tables before
 * adding a fourth exclusion; most new org_id tables should NOT go in this set.
 */
export const NOT_TENANT_OWNED = new Set([
  "error_logs",
  "rate_limit_hits",
  "tenant_usage_metrics",
]);

/**
 * Every tenant-scoped table, found by reflection over the schema module rather than a
 * second hand-maintained list — `deleteOrganization()` (src/lib/platform/registry.ts) has
 * its own explicit list for the same "every table with org_id" concept, kept as a plain
 * hand-written list on purpose since that function is safety-critical (see its own doc
 * comment) and was deliberately not refactored to depend on this reflection. This helper
 * exists so OTHER code — `usageMetrics.ts`'s cross-org aggregation, and the cascade-lint
 * test that checks `deleteOrganization()`'s list for drift — can derive the same set
 * without a third hand-maintained copy.
 */
export function tenantScopedTables(): PgTable[] {
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

/** Maps a schema table's own SQL name (e.g. "stock_ledger") back to the name it's
 * exported under in src/db/schema (e.g. "stockLedger") — what registry.ts's source
 * actually writes in a `db.delete(stockLedger)` call, which is what the cascade-lint test
 * needs to search for. */
export function tenantScopedTableExportNames(): string[] {
  const byTable = new Map<PgTable, string>();
  for (const [exportName, value] of Object.entries(schema)) {
    if (is(value, PgTable)) byTable.set(value, exportName);
  }
  return tenantScopedTables().map((table) => byTable.get(table) ?? getTableName(table));
}
