import { pgTable, text, unique } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors src/lib/settings.ts's per-org key-value "Settings" tab (connected sheet URLs,
 * ChatXFlow token, IQC TAT defaults, etc.) — one row per (org, key).
 *
 * No surrogate id: the natural key is (org_id, key), enforced with a unique constraint so
 * upsertSetting()'s "update if exists, else insert" logic has something to conflict on.
 */
export const settings = pgTable(
  "settings",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
  },
  (table) => [unique("settings_org_id_key_unique").on(table.orgId, table.key)]
);
