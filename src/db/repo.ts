import { and, eq } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { PgColumn, PgTable, TableConfig } from "drizzle-orm/pg-core";
import { db } from "@/db/client";

/**
 * Generic data-access layer every domain file's uniform CRUD (Phase 3) builds on, so "no
 * query may omit an org_id predicate" lives in one reviewable place instead of being
 * re-derived by all 17 remaining domain modules.
 *
 * Two constraints, enforced by TypeScript rather than at runtime:
 *
 * - `OrgScopedTable` — the table has an `orgId` column. Every tenant-owned table in
 *   `src/db/schema/**` satisfies this (see each file's own comments); `organizations` and
 *   `usersIndex` (src/db/schema/platform.ts) deliberately do not, since they describe
 *   organizations rather than belonging to one — passing either here is a compile error.
 * - `IdentifiedTable` — on top of that, the table has a single, plain `id` text primary
 *   key column. This is what `findById`/`updateById`/`deleteById` require. It is
 *   deliberately narrower than "has a primary key": `fms_templates` (PK
 *   `(template_id, step_no)`), `bom` (PK `(bom_id, line_no)`) and `plan_materials` (PK
 *   `(plan_id, sku)`) all have composite keys, and `items`' primary key column exists but
 *   is named `sku`, not `id` — none of those satisfy this constraint, so calling
 *   `findById(items, ...)` or `findById(bom, ...)` is a type error, not a function that
 *   silently runs the wrong query. Those tables get direct, bespoke Drizzle queries in
 *   their own Phase 3 domain file instead (see that file's own module docs for exactly
 *   which ones). `holiday_list` (PK `(org_id, date)`) and `settings` (unique
 *   `(org_id, key)`, no primary key at all) are excluded the same way.
 */
type OrgScopedTable = PgTable<TableConfig> & { orgId: PgColumn };
type IdentifiedTable = OrgScopedTable & { id: PgColumn };

/**
 * `T`'s own column objects (e.g. `table.orgId`) are fully typed and are what every caller
 * of this file interacts with — but handing the generic `table: T` itself to `db.select()
 * .from()`/`db.insert()`/`db.update()`/`db.delete()` doesn't type-check: those methods'
 * overloads need a *concrete* `TableConfig` to resolve against (to compute the exact shape
 * of `.returning()`, for instance), and a generic type parameter isn't one, even though at
 * every real call site `T` is one specific concrete table. This narrows `table` to `PgTable`
 * for the query-builder calls only; the function's exported signature (and the
 * `InferSelectModel<T>`/`InferInsertModel<T>` casts on the way out) is what keeps the
 * actual type safety callers rely on.
 */
function asPgTable(table: OrgScopedTable): PgTable<TableConfig> {
  return table as PgTable<TableConfig>;
}

/** Every row in `table` belonging to `orgId`. */
export async function listByOrg<T extends OrgScopedTable>(
  table: T,
  orgId: string
): Promise<InferSelectModel<T>[]> {
  const rows = await db.select().from(asPgTable(table)).where(eq(table.orgId, orgId));
  return rows as InferSelectModel<T>[];
}

/** One row by its primary key, scoped to `orgId` — null if it doesn't exist or belongs to another org. */
export async function findById<T extends IdentifiedTable>(
  table: T,
  orgId: string,
  id: string
): Promise<InferSelectModel<T> | null> {
  const rows = await db
    .select()
    .from(asPgTable(table))
    .where(and(eq(table.orgId, orgId), eq(table.id, id)))
    .limit(1);
  return (rows[0] as InferSelectModel<T> | undefined) ?? null;
}

/**
 * Inserts one row and returns it as written.
 *
 * No separate `orgId` parameter — `values` already has to carry its own `org_id` for the
 * insert to succeed against the column's `notNull()` constraint, so a second parameter
 * would just be a second place for the two to silently disagree. What this DOES check is
 * that `orgId` wasn't simply forgotten (an empty/undefined `orgId` in `values` is exactly
 * the "which tenant does this row belong to" bug this whole layer exists to catch) —
 * caught here, at the one shared chokepoint, instead of as a Postgres NOT NULL error whose
 * stack trace points at some unrelated call site three domain files away.
 */
export async function insertRecord<T extends OrgScopedTable>(
  table: T,
  values: InferInsertModel<T>
): Promise<InferSelectModel<T>> {
  const orgId = (values as Record<string, unknown>).orgId;
  if (!orgId || typeof orgId !== "string") {
    throw new Error(
      "insertRecord: values.orgId is missing — every tenant-scoped insert must set its own org_id."
    );
  }
  const [row] = await db
    .insert(asPgTable(table))
    .values(values as Record<string, unknown>)
    .returning();
  return row as InferSelectModel<T>;
}

/**
 * Patches one row by its primary key, scoped to `orgId`. Returns the updated row, or null
 * if no row matched `(orgId, id)` — the patch is silently a no-op rather than throwing, the
 * same "not found is a normal outcome, not an exception" convention the rewritten Phase 1
 * files (e.g. registry.ts's `getOrganization`) already use; callers that need "must exist"
 * semantics check the null themselves, same as they already do for the finders.
 */
export async function updateById<T extends IdentifiedTable>(
  table: T,
  orgId: string,
  id: string,
  patch: Partial<InferInsertModel<T>>
): Promise<InferSelectModel<T> | null> {
  const rows = await db
    .update(asPgTable(table))
    .set(patch as Record<string, unknown>)
    .where(and(eq(table.orgId, orgId), eq(table.id, id)))
    .returning();
  return (rows[0] as InferSelectModel<T> | undefined) ?? null;
}

/** Deletes one row by its primary key, scoped to `orgId`. Returns whether a row was actually deleted. */
export async function deleteById<T extends IdentifiedTable>(
  table: T,
  orgId: string,
  id: string
): Promise<boolean> {
  const rows = await db
    .delete(asPgTable(table))
    .where(and(eq(table.orgId, orgId), eq(table.id, id)))
    .returning({ id: table.id });
  return rows.length > 0;
}
