import { index, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Maintenance — breakdown and general upkeep requests, with one real side effect:
 * a "Breakdown" request linked to a running Production Line step (an `fms_runs` row)
 * pauses that step's TAT clock for as long as the breakdown is open, and shifts the
 * deadline forward by the same real duration once it's resolved — see
 * src/lib/maintenance/maintenance.ts for the pause/resume mechanics and
 * src/lib/mis.ts/isFmsStepOverdue for why a Paused run never counts as "Not Done".
 *
 * Every other kind (Generator Repair, Servicing, Wiring, Light Change, Other) is a
 * standalone log — `productionLineRunId` stays blank, nothing pauses.
 *
 * Two-step close, deliberately not one: Maintenance marking "fixed" is their own claim,
 * not proof. Only the person who originally reported it (`reportedBy`, the step's own
 * assignee at breakdown time) can confirm the fix actually holds — `confirm()` is the
 * only thing that resumes the paused step. Mirrors every other module's own
 * `*_activities` append-only timeline convention (orders, leads, pdi, tms, dispatch).
 */
export const maintenanceKindEnum = pgEnum("maintenance_kind", [
  "Breakdown",
  "Generator_Repair",
  "Servicing",
  "Wiring",
  "Light_Change",
  "Other",
]);

export const maintenanceStatusEnum = pgEnum("maintenance_status", [
  "Open",
  "Fixed_By_Maintenance",
  "Resolved",
  "Cancelled",
]);

export const maintenanceRequests = pgTable(
  "maintenance_requests",
  {
    // Request_ID, e.g. "MNT-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    kind: maintenanceKindEnum("kind").notNull(),
    // Only set for kind = "Breakdown" against a running Production Line — the fms_runs
    // row that got paused. Blank for every standalone kind.
    productionLineRunId: text("production_line_run_id").notNull().default(""),
    productionLineTemplateName: text("production_line_template_name").notNull().default(""),
    description: text("description").notNull().default(""),
    status: maintenanceStatusEnum("status").notNull().default("Open"),
    reportedBy: text("reported_by").notNull().default(""),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
    // Whoever picks this up on the Maintenance side — optional, anyone holding the
    // module grant can still act on an unassigned request.
    assignedTo: text("assigned_to").notNull().default(""),
    fixedBy: text("fixed_by").notNull().default(""),
    fixedAt: timestamp("fixed_at", { withTimezone: true }),
    fixedRemark: text("fixed_remark").notNull().default(""),
    // Set only by reportedBy — see this file's own header comment.
    confirmedBy: text("confirmed_by").notNull().default(""),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedRemark: text("confirmed_remark").notNull().default(""),
    // The paused step's own tat_deadline at the moment this breakdown opened — the
    // reference point confirm() shifts forward by the real elapsed duration. Blank for
    // a standalone (non-Breakdown) request.
    pausedTatDeadline: timestamp("paused_tat_deadline", { withTimezone: true }),
    // How many real working minutes (the assignee's own calendar) this breakdown cost —
    // a reporting figure only; the actual deadline shift uses wall-clock elapsed time
    // (see maintenance.ts), not this number, since the step was not progressing at all
    // while paused regardless of whether the clock ticking was a working or off hour.
    workingMinutesLost: numeric("working_minutes_lost"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("maintenance_requests_org_id_idx").on(table.orgId),
    index("maintenance_requests_org_id_status_idx").on(table.orgId, table.status),
    index("maintenance_requests_org_id_run_id_idx").on(table.orgId, table.productionLineRunId),
  ]
);

// MaintenanceActivityRecord.Kind — one row per event, append-only, same convention as
// order_activities/lead_activities/pdi_activities/tms_activities/dispatch_activities.
export const maintenanceActivityKindEnum = pgEnum("maintenance_activity_kind", [
  "Note",
  "Reported",
  "Assigned",
  "Fixed_By_Maintenance",
  "Resolved",
  "Reopened",
  "Cancelled",
]);

export const maintenanceActivities = pgTable(
  "maintenance_activities",
  {
    // Activity_ID, e.g. "MAC-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    requestId: text("request_id").notNull(),
    kind: maintenanceActivityKindEnum("kind").notNull(),
    message: text("message").notNull(),
    actorId: text("actor_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("maintenance_activities_org_id_request_id_idx").on(table.orgId, table.requestId)]
);
