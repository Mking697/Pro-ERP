import { numeric, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Dispatch — leg 5, the last leg of the Sales chain (Lead -> Order -> PDI -> TMS ->
 * Dispatch). One row per TMS shipment (`tms_shipments`, 1:1 via that table's own
 * `dispatch_id` forward-pointer — see src/db/schema/tms.ts) — a physical vehicle leaving
 * the premises is Dispatch's unit of work, same granularity TMS already uses.
 *
 * Two real steps, not one:
 * 1. **Confirm Dispatch** — issues a sequential Gate Pass number (same read-highest-then-
 *    retry-on-collision allocator as `quotations.quotationNo`, backed by this table's own
 *    `(org_id, gate_pass_no)` unique constraint — added from the start this time, unlike
 *    quotations' own number, which needed a follow-up migration to add it), and is the one
 *    genuinely load-bearing write in this whole leg: it writes the real `stock_ledger`
 *    "Out" movement for exactly what this shipment carries (`tms_shipment_items`) — nothing
 *    upstream of Dispatch (PDI, Order FMS's Stock_Check, TMS) ever touches the ledger, only
 *    reserves. This also assigns someone to track the shipment while `In_Transit`, with a
 *    TAT entered at assignment time (not a fixed org-wide setting, unlike Purchase/Order
 *    Setup's own per-step TAT) — computed via that person's own working-hours calendar
 *    (`computeTatDeadline()`, src/lib/fms/calendar.ts), same mechanism FMS steps use.
 * 2. **Mark Dispatched** — the assignee (or anyone holding the module grant) closes it out
 *    once the transit is done, with an optional "Proof of Dispatch" attachment (evidence the
 *    transit itself completed — a signed LR, transporter's own confirmation — deliberately
 *    NOT the customer-side Proof of Delivery, which is out of scope for this pass by
 *    explicit user choice).
 */
export const dispatchStatusEnum = pgEnum("dispatch_status", ["In_Transit", "Dispatched"]);

export const dispatches = pgTable(
  "dispatches",
  {
    // Dispatch_ID, e.g. "DSP-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    orderId: text("order_id").notNull(),
    // The tms_shipments row this dispatch is for — one dispatch per shipment.
    shipmentId: text("shipment_id").notNull(),
    gatePassNo: text("gate_pass_no").notNull().default(""),
    gatePassAttachmentUrl: text("gate_pass_attachment_url").notNull().default(""),
    // Who tracks this shipment while In_Transit, and by when — entered at Confirm-Dispatch
    // time, per this specific shipment, not a fixed Setup value.
    assignedTo: text("assigned_to").notNull().default(""),
    tatValue: numeric("tat_value"),
    tatUnit: text("tat_unit").notNull().default(""),
    tatDeadline: timestamp("tat_deadline", { withTimezone: true }),
    status: dispatchStatusEnum("status").notNull().default("In_Transit"),
    // Optional — evidence the transit itself completed, not customer-side delivery proof
    // (deferred, see this file's own header comment).
    proofOfDispatchUrl: text("proof_of_dispatch_url").notNull().default(""),
    dispatchedBy: text("dispatched_by").notNull().default(""),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("dispatches_org_id_gate_pass_no_unique").on(table.orgId, table.gatePassNo)]
);

// DispatchActivityRecord.Kind — mirrors every other leg's own append-only timeline.
export const dispatchActivityKindEnum = pgEnum("dispatch_activity_kind", [
  "Note",
  "Gate_Pass_Issued",
  "Assigned",
  "Dispatched",
]);

export const dispatchActivities = pgTable("dispatch_activities", {
  // Activity_ID, e.g. "DAC-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  orderId: text("order_id").notNull(),
  kind: dispatchActivityKindEnum("kind").notNull(),
  message: text("message").notNull(),
  actorId: text("actor_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
