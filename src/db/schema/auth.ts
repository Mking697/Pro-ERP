import { index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors src/lib/auth/users.ts's SheetUser / USERS_HEADERS — the "Users" tab of each
 * organization's own System spreadsheet, now one shared, org-scoped table.
 */

export const userStatusEnum = pgEnum("user_status", ["Active", "Inactive"]);

export const users = pgTable(
  "users",
  {
    // User_ID, e.g. "UID-xxxx" — verbatim, no surrogate key.
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    // Role vocabulary (src/lib/roles.ts: Admin/MD/Delegator/IQC/Employee) is closed today
    // but not a per-row Status column — kept as `text` per the plan's "genuinely
    // open-ended [columns outside Status] stay text" guidance rather than pgEnum.
    role: text("role").notNull(),
    department: text("department").notNull().default(""),
    phoneNumber: text("phone_number").notNull().default(""),
    status: userStatusEnum("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull().default(""),
    // Comma-separated module keys (src/lib/moduleAccess.ts) become a native Postgres array
    // — deletes serializeModuleAccess's manual join/split.
    moduleAccess: text("module_access").array().notNull().default([]),
    // FMS shift id (e.g. "1", "2") — src/lib/fms/calendar.ts. Blank/omitted defaults to "1"
    // at the application layer, same as today.
    shift: text("shift").notNull().default("1"),
    // Another user's id, or "" if unset — the first stop in this person's Leave approval
    // chain when their org's own Leave Approval Setup has a "Reporting Manager" step. Plain
    // text, not FK-enforced, matching every other cross-entity reference in this schema.
    reportingManagerId: text("reporting_manager_id").notNull().default(""),
  },
  (table) => [index("users_org_id_idx").on(table.orgId)]
);
