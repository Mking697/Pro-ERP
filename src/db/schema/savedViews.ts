import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * "Saved Views/Filters" (roadmap Phase 3 item #12) — lets a user save their current
 * filter/search/sort configuration on a data table (Orders, Inventory, and any future
 * module that adopts src/components/saved-views-bar.tsx) under a name, and re-apply it
 * later with one click.
 *
 * `module` is a plain string (not a pgEnum) deliberately — "orders" | "inventory" today,
 * but a new module can start saving/loading views with zero schema change, only a new
 * string literal at its own call site. Same reasoning as settings.ts's own free-text `key`.
 *
 * `userId` + a NOT per-user-shared read: a saved view is private to whoever created it,
 * never visible to another user in the same org — this mirrors chat_sessions/chat_messages
 * (src/db/schema/chatbot.ts, "a session is private to whoever started it") rather than
 * settings.ts's ONBOARDING_DISMISSED (which is a single org-wide flag with no owner
 * concept at all). There is no existing "shared across the org" convention for anything
 * genuinely per-user like this to follow instead, so every list/create/delete in
 * src/lib/savedViews.ts filters by (org_id, user_id) — never org_id alone.
 *
 * `filters` is `jsonb`, deliberately typed as the generic `Record<string, unknown>`
 * rather than a per-module union: each board component (see types.ts/orders-board.tsx,
 * types.ts/inventory-board.tsx) defines its own exact filters shape and casts on the way
 * in/out — mirrors fms.ts's own `jsonb(...).$type<...>()` tables, which also hold a
 * module-specific shape behind one broad jsonb column.
 *
 * Plain `id`-PK, org-scoped — satisfies src/db/repo.ts's `IdentifiedTable` constraint, so
 * `findById`/`insertRecord` work against it without a bespoke query (list/delete still
 * need a bespoke `userId` predicate, since ownership scoping is narrower than org scoping).
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    module: text("module").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("saved_views_org_id_module_user_id_idx").on(table.orgId, table.module, table.userId),
  ]
);
