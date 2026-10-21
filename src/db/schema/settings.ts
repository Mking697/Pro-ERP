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

/**
 * Same key-value shape as `settings` above, but scoped per (org, user) instead of per
 * org — for preferences that belong to one person, not the whole organization (today:
 * dashboard widget show/hide + order, src/lib/dashboardWidgets.ts). A per-org row would
 * mean every user in the org shares one layout; a per-user row is what actually matches
 * "this is MY dashboard's layout," the same way accent/theme/locale are already
 * per-browser cookies rather than org settings.
 *
 * Not reusing `settings` with a nullable `userId` column: that would change the meaning
 * and uniqueness of every existing row/caller of getSetting()/upsertSetting() (org-wide
 * settings have no user at all, not a null one) for a feature that only needs one new
 * key. A separate table keeps both call sites simple and keeps `settings`'s existing
 * (org_id, key) unique constraint untouched.
 */
export const userSettings = pgTable(
  "user_settings",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
  },
  (table) => [
    unique("user_settings_org_id_user_id_key_unique").on(table.orgId, table.userId, table.key),
  ]
);
