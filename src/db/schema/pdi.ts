import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * PDI (Pre-Dispatch Inspection) — leg 3 of the Sales chain (Lead -> Order -> PDI -> TMS ->
 * Dispatch, TMS/Dispatch not built yet). A thin, hardcoded module: unlike Order FMS, it owns
 * no stock/money logic of its own — it only tracks the inspection itself. Whether an order
 * is still short is never duplicated here; it's read live off `orders`/`order_items`
 * (`shortageQty`), matching this codebase's "no figure is ever stored anywhere — it is
 * always worked out afresh" philosophy.
 *
 * One row per Order, same candidate-queue handoff convention used twice already (Lead's
 * `quotations.orderId` -> Order FMS; here, `orders.pdiId` -> PDI): the intake queue is a
 * cheap `orders WHERE status = 'Ready_For_PDI' AND pdi_id = ''` scan, no push/event needed
 * to create the row.
 */
export const pdiStatusEnum = pgEnum("pdi_status", ["Pending", "Passed"]);

export const pdiInspections = pgTable("pdi_inspections", {
  // PDI_ID, e.g. "PDI-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  orderId: text("order_id").notNull(),
  status: pdiStatusEnum("status").notNull().default("Pending"),
  // Order FMS's own dispatchCommitDate minus one day, computed once at creation — when this
  // inspection should be done by.
  dueAt: timestamp("due_at", { withTimezone: true }),
  // The most recent inspection report, if one was attached — a convenience column
  // alongside the full history each attempt keeps on pdi_activities.attachmentUrl (same
  // "flat current-state column next to the full activity trail" pattern as
  // orders.creditApprovedBy/At). Optional — inspecting without a report is normal.
  attachmentUrl: text("attachment_url").notNull().default(""),
  passedBy: text("passed_by").notNull().default(""),
  passedAt: timestamp("passed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// PdiActivityRecord.Kind — mirrors order_activities/lead_activities' own append-only
// timeline convention. "Waiting_Stock"/"Stock_Available" bracket the automatic recheck
// Order FMS runs whenever FG stock arrives (src/lib/orders/orders.ts); "Inspected_Fail"
// loops the status back to Pending rather than advancing it, so a fixable defect doesn't
// need a new PDI row — the same inspection is retried and re-logged.
export const pdiActivityKindEnum = pgEnum("pdi_activity_kind", [
  "Note",
  "Waiting_Stock",
  "Stock_Available",
  "Inspected_Pass",
  "Inspected_Fail",
]);

export const pdiActivities = pgTable("pdi_activities", {
  // Activity_ID, e.g. "PDA-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  pdiId: text("pdi_id").notNull(),
  kind: pdiActivityKindEnum("kind").notNull(),
  message: text("message").notNull(),
  // Optional — this specific inspection attempt's own report, if one was attached.
  attachmentUrl: text("attachment_url").notNull().default(""),
  actorId: text("actor_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
