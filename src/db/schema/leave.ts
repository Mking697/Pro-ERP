import { boolean, date, integer, numeric, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * The Leave system: a Doer files a leave, it goes through the org's own configurable
 * approval chain, and once fully Approved its open Tasks/FMS steps redirect to a buddy for
 * the leave's duration — then revert once it ends. See src/lib/leave/*.ts.
 *
 * Every cross-entity id below (doerId, buddyId, approverId, entityId, …) is plain text,
 * not FK-enforced, matching every other cross-entity reference in this schema (see
 * parties.ts's vendorItems doc comment for why).
 */

export const leaveApproverTypeEnum = pgEnum("leave_approver_type", [
  "REPORTING_MANAGER",
  "SPECIFIC_USER",
]);

/**
 * The org's own approval chain, set once in Admin Settings (Purchase Setup's own
 * "N steps, each with a Doer" pattern) — one row per step, ordered by stepNo. A
 * REPORTING_MANAGER step resolves dynamically per leave (whoever the requester's own
 * Users.reportingManagerId points to); a SPECIFIC_USER step is a fixed person (e.g. HR,
 * MD) the Admin names directly, the same way Purchase Setup names a fixed Doer per step.
 */
export const leaveApprovalSteps = pgTable("leave_approval_steps", {
  // LAS_ID, e.g. "LAS-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  stepNo: integer("step_no").notNull(),
  approverType: leaveApproverTypeEnum("approver_type").notNull(),
  specificUserId: text("specific_user_id").notNull().default(""),
});

export const leaveStatusEnum = pgEnum("leave_status", [
  "Pending",
  "Approved",
  "Rejected",
  "Cancelled",
]);

export const leaves = pgTable("leaves", {
  // Leave_ID, e.g. "LV-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  doerId: text("doer_id").notNull(),
  leaveType: text("leave_type").notNull().default(""),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason").notNull().default(""),
  buddyId: text("buddy_id").notNull().default(""),
  // True when HR filed this on the Doer's behalf (they couldn't file it themselves) —
  // see src/lib/leave/leaves.ts's createEmergencyLeave.
  isEmergency: boolean("is_emergency").notNull().default(false),
  filedBy: text("filed_by").notNull().default(""),
  status: leaveStatusEnum("status").notNull().default("Pending"),
  // Which leave_approval_steps.stepNo is the next one waiting on a decision — advances as
  // each step approves; the leave itself flips to Approved once the last step does.
  currentStepNo: integer("current_step_no").notNull().default(1),
  // Set once the buddy reassignment has actually run for this leave (its start date has
  // arrived) — null until then, even after the leave itself is Approved, since an
  // Approved-but-future leave hasn't started redirecting work yet.
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  // Set once the reassigned work has been handed back after the leave ended — null until then.
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveApprovalDecisionEnum = pgEnum("leave_approval_decision", [
  "Pending",
  "Approved",
  "Rejected",
]);

/** One row per leave per approval step — the audit trail of who decided what, mirroring
 * fms_runs' one-row-per-step-instance shape. */
export const leaveApprovals = pgTable("leave_approvals", {
  // LAP_ID, e.g. "LAP-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  leaveId: text("leave_id").notNull(),
  stepNo: integer("step_no").notNull(),
  // The real person this step resolved to for this specific leave (a Reporting Manager
  // step resolves differently per requester) — snapshotted here so a later Reporting
  // Manager change never rewrites who was actually asked to decide.
  approverId: text("approver_id").notNull(),
  decision: leaveApprovalDecisionEnum("decision").notNull().default("Pending"),
  remark: text("remark").notNull().default(""),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Every Task/FMS-run this leave's buddy redirect actually touched — how the revert at
 * leave-end knows exactly what to hand back, and to whom, without guessing. */
export const leaveReassignments = pgTable("leave_reassignments", {
  // LRA_ID, e.g. "LRA-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  leaveId: text("leave_id").notNull(),
  // "TASK" | "FMS_RUN".
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  originalAssignee: text("original_assignee").notNull(),
  buddyId: text("buddy_id").notNull(),
  reassignedAt: timestamp("reassigned_at", { withTimezone: true }).notNull().defaultNow(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
});

/**
 * Leave balance/quota (2026-09-22) — simple v1 by explicit choice: a fixed annual day
 * count per leave type, no accrual and no carry-forward. Quotas are opt-in per org per
 * leave type — a leave type with no row here has no limit at all, so an org that only
 * wants to cap "Casual" leaves doesn't have to also configure "Sick"/"Earned"/"Other".
 * Enforced in `createLeave()` (src/lib/leave/leaves.ts): a request that would push the
 * doer's used days for that type, in the calendar year of its own startDate, over this
 * quota is refused outright — a hard block, not a warn-and-allow, so every leave that
 * ever exists is by construction within quota (this is also what keeps Payroll v1 simple:
 * approved leave never needs an "unpaid" flag, because it can never have gone over quota
 * to begin with).
 */
export const leaveQuotas = pgTable(
  "leave_quotas",
  {
    // Leave_Quota_ID, e.g. "LQ-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // Matches LEAVE_TYPES in src/lib/leave/leaves.ts ("Casual" | "Sick" | "Earned" | "Other").
    leaveType: text("leave_type").notNull(),
    annualDays: numeric("annual_days").notNull().default("0"),
  },
  (table) => [unique("leave_quotas_org_id_leave_type_unique").on(table.orgId, table.leaveType)]
);
