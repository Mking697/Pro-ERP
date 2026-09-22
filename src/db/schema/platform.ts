import { integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The platform registry — mirrors src/lib/platform/registry.ts's two Google Sheets tabs
 * (Organizations, Users_Index) on the current platform registry spreadsheet.
 *
 * These two tables deliberately do NOT get an `org_id` tenant-scoping column: they
 * describe organizations, they don't belong to one. Every other table in this schema is
 * tenant-scoped and references `organizations.id`.
 */

export const orgStatusEnum = pgEnum("org_status", ["Active", "Suspended"]);

export const organizations = pgTable("organizations", {
  // Org_ID, e.g. "ORG-xxxx" — verbatim, no surrogate key.
  id: text("id").primaryKey(),
  orgName: text("org_name").notNull(),
  // Unique platform-wide: used to route by URL and to de-duplicate on signup.
  slug: text("slug").notNull().unique(),
  ownerEmail: text("owner_email").notNull(),
  plan: text("plan").notNull().default("Free"),
  status: orgStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Mirrors SheetUser.Status ("Active" | "Inactive") — a separate enum type from
// auth.ts's own user_status so this file stays self-contained (no cross-file enum
// import, no risk of an import cycle with auth.ts, which itself references
// `organizations` from this file).
export const usersIndexStatusEnum = pgEnum("users_index_status", ["Active", "Inactive"]);

export const usersIndex = pgTable("users_index", {
  // Email is the real key here: login's first hop resolves an org from the email alone,
  // and an email must identify exactly one account across the whole platform.
  email: text("email").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  // The corresponding row in that org's `users` table (auth.ts). Not declared as an FK
  // here — `users` lives in a different schema file (auth.ts) that already references
  // `organizations` from this file, and a back-reference here would create an import
  // cycle for no real benefit at this scale.
  userId: text("user_id").notNull(),
  status: usersIndexStatusEnum("status").notNull().default("Active"),
});

/**
 * Public, read-only report links — mirrors src/lib/platform/shares.ts's REPORT_SHARES_TAB.
 * Missing from the first pass of this schema (caught during Phase 3's Reports/share-links
 * group) — lives alongside `organizations`/`usersIndex` rather than under a per-org table,
 * for the same reason `usersIndex` does: a visitor resolves a link from the token alone,
 * with no session/org context to scope a per-org lookup by.
 *
 * `token` is the primary key directly (not a `generateId()` id) — it's already the
 * credential a visitor holds, there is nothing else to key on. No `status` column: the
 * application already deletes a row outright to revoke it (never flips a flag back to
 * Active), so "row exists" already means "Active" — a redundant status column would just
 * be one more place for that fact to drift out of sync with the row's real presence.
 */
export const reportShares = pgTable("report_shares", {
  token: text("token").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  report: text("report").notNull(),
  label: text("label").notNull(),
  rangeKey: text("range_key").notNull(),
  fromDate: text("from_date").notNull().default(""),
  toDate: text("to_date").notNull().default(""),
  // The creator's grants, copied at creation time rather than read live — see
  // shares.ts's createReportShare(). Mirrors users.moduleAccess's text[] convention.
  access: text("access").array().notNull().default([]),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Fixed-window request counters for a handful of public-ish, unauthenticated endpoints
 * (`/api/signup`, `/api/auth/login`, `/share/[token]`) that have no session/org to scope
 * a per-tenant limit by — lives alongside `usersIndex`/`reportShares` for the same reason:
 * the request is identified by something outside any tenant (an IP, an email, a token),
 * not by `org_id`. See src/lib/rateLimit.ts for the actual check/increment.
 *
 * One row per (scope, identifier, window) — `id` is the three joined into one string
 * rather than a composite PK, since every caller already builds the row by that same key
 * and an upsert-by-single-column `onConflictDoUpdate` is simpler than a 3-column target.
 * Old rows are never read back once their window has passed; a stray row from an
 * unlucky/malicious burst is harmless clutter, not a correctness issue, so there is
 * deliberately no cleanup job for this table yet — cheap to add later if row count ever
 * becomes a real concern.
 */
export const rateLimitHits = pgTable("rate_limit_hits", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  identifier: text("identifier").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});
