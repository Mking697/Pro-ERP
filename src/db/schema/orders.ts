import { numeric, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Order FMS — leg 2 of the Sales chain (Lead -> Order -> PDI -> Dispatch). A hardcoded
 * flow, not a generic FMS Template, same reasoning as Lead FMS and Purchase FMS.
 *
 * Two entry paths converge into one pipeline:
 * - **Lead-sourced**: an Accepted `quotations` row with `order_id = ''` sits in Order FMS's
 *   own intake queue (mirrors `indents.poId`/Purchase's own candidate-finding — see that
 *   field's own comment) until Ops opens it, maps its free-text lines to real Items, and
 *   confirms/creates the actual Customer Master row behind it (a Lead-driven quotation was
 *   never required to point at one — see Module 16). Starts life as `Items_Pending`.
 * - **Direct**: a salesperson fills their own Order Form against a Customer Master row
 *   they can already see (their own — same `created_by` scoping as the walk-in Quotation
 *   picker), picking real Items from the start. Starts life straight at `Payment_Review`
 *   since there is nothing left to map.
 *
 * Every stored money/state figure is either a plain snapshot (address, party details — a
 * document fact that must not silently change later) or genuinely derived at read time
 * (payment/credit position, reserved stock) — never a number written once and trusted,
 * matching this codebase's own stated philosophy ("no figure is ever stored anywhere — it
 * is always worked out afresh from the real entries").
 */

export const orderStatusEnum = pgEnum("order_status", [
  "Items_Pending",
  "Payment_Review",
  "Credit_Hold",
  "Stock_Check",
  "Dispatch_Pending",
  "Ready_For_PDI",
  "Cancelled",
]);

// Who arranges the dispatch vehicle — decides TMS's own branch (src/db/schema/tms.ts):
// "Self" runs the full vendor/vehicle/freight flow ("Freight Paid"); "Party" (the customer
// arranges their own pickup) only needs a Follow-up + Loading-Dock confirmation ("To Pay").
// Nullable, no default: orders created before this column existed have neither, and TMS's
// own intake must treat that as "not yet decided" rather than silently guessing one.
export const transportArrangedByEnum = pgEnum("transport_arranged_by", ["Self", "Party"]);

export const orders = pgTable("orders", {
  // Order_ID, e.g. "ORD-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  // ORDER_SOURCES ("Lead" | "Direct") — closed but not itself a Status column, kept text.
  source: text("source").notNull().default("Direct"),
  transportArrangedBy: transportArrangedByEnum("transport_arranged_by"),
  // "" for a Direct order.
  leadId: text("lead_id").notNull().default(""),
  quotationId: text("quotation_id").notNull().default(""),
  // "" only transiently, for a Lead-sourced order still sitting in Items_Pending — Ops
  // confirming/creating the real Customer Master row is part of clearing that status,
  // exactly like a walk-in Quotation's own Existing/New Customer step. Always set for a
  // Direct order from the moment it's created.
  customerId: text("customer_id").notNull().default(""),
  // Party/address snapshot, same reasoning as quotations' own header fields — a document
  // fact as it stood when the order was placed, not a live read of the customer record.
  partyName: text("party_name").notNull().default(""),
  contactPerson: text("contact_person").notNull().default(""),
  customerMobile: text("customer_mobile").notNull().default(""),
  customerEmail: text("customer_email").notNull().default(""),
  customerGst: text("customer_gst").notNull().default(""),
  billingAddress: text("billing_address").notNull().default(""),
  billingCity: text("billing_city").notNull().default(""),
  billingState: text("billing_state").notNull().default(""),
  billingPincode: text("billing_pincode").notNull().default(""),
  shippingPartyName: text("shipping_party_name").notNull().default(""),
  shippingContactPerson: text("shipping_contact_person").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  shippingCity: text("shipping_city").notNull().default(""),
  shippingState: text("shipping_state").notNull().default(""),
  shippingPincode: text("shipping_pincode").notNull().default(""),
  // The customer's own PO document, if they gave one — optional, matches Purchase's own
  // "PO attachment" upload via the existing Blob path.
  poAttachmentUrl: text("po_attachment_url").notNull().default(""),
  status: orderStatusEnum("status").notNull().default("Items_Pending"),
  // Total order value — from the source quotation's payableAmount, or typed directly for a
  // Direct order. What Payment_Review's credit-limit math is checked against; never
  // recomputed from order_items after the fact, same "a document fact as it stood" reasoning
  // as the party snapshot above.
  orderValue: numeric("order_value").notNull().default("0"),
  // Who/when cleared a Credit_Hold — a flat convenience column alongside the full
  // order_activities trail, same coexistence as fms_runs.completedBy/completedAt next to
  // its own chaining history.
  creditApprovedBy: text("credit_approved_by").notNull().default(""),
  creditApprovedAt: timestamp("credit_approved_at", { withTimezone: true }),
  dispatchCommitDate: timestamp("dispatch_commit_date", { withTimezone: true }),
  // "" until PDI punches this Ready_For_PDI order into an inspection — same forward-pointer
  // convention as quotations.orderId (see that column's own comment).
  pdiId: text("pdi_id").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per line, grouped by Order_ID — same flat-rows-by-group shape as
 * `quotation_items`/`bom`, composite PK (order_id, line_no). Unlike `quotation_items` (free
 * text, a customer-facing document), `sku` here is a real Items-master reference from the
 * start, because Order FMS's whole job depends on knowing exactly what it's reserving.
 *
 * `qty`/`reservedQty`/`shortageQty` mirrors `plan_materials`'s own
 * requiredQty/allocatedQty/shortageQty split exactly, for the same reason: a line can be
 * partially satisfied from Free stock, and both numbers need to survive independently
 * rather than one being silently overwritten by the other.
 */
export const orderItems = pgTable(
  "order_items",
  {
    orderId: text("order_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    lineNo: text("line_no").notNull(),
    // "" only transiently, on a Lead-sourced order's unmapped lines before Step 1 completes.
    sku: text("sku").notNull().default(""),
    itemName: text("item_name").notNull().default(""),
    uom: text("uom").notNull().default(""),
    qty: numeric("qty").notNull().default("0"),
    rate: numeric("rate").notNull().default("0"),
    amount: numeric("amount").notNull().default("0"),
    // Set once Stock_Check actually runs — 0 until then, same "not yet computed" meaning
    // Column defaults use elsewhere in this schema (e.g. plan_materials before allocation).
    reservedQty: numeric("reserved_qty").notNull().default("0"),
    shortageQty: numeric("shortage_qty").notNull().default("0"),
    // Set by Dispatch (leg 5, src/db/schema/dispatch.ts) once this line's quantity is
    // actually written to stock_ledger as a real "Out" — mirrors plan_materials'
    // allocatedQty/consumedQty split exactly, for the identical reason: `orderReservedBySku()`
    // (src/lib/orders/orders.ts) must subtract this from `reservedQty` (matching
    // `committedBySku()`'s own `allocatedQty - consumedQty`), or a dispatched order's stock
    // would stay double-counted forever — genuinely gone from on-hand (the ledger Out already
    // reduced it) AND still "reserved" against Free stock, since nothing else ever advances
    // an Order FMS order's own `status` past `Ready_For_PDI`.
    consumedQty: numeric("consumed_qty").notNull().default("0"),
  },
  (table) => [primaryKey({ columns: [table.orderId, table.lineNo] })]
);

export const orderPaymentModeEnum = pgEnum("order_payment_mode", [
  "Cash",
  "UPI",
  "Bank_Transfer",
  "Cheque",
  "Card",
  "Other",
]);

/**
 * One row per payment received against an order — advance and every later installment
 * alike, append-only. "How much has this customer actually paid, and are they current" is
 * always the sum of these rows, never a stored running total (same derived-not-stored
 * philosophy as the rest of this schema) — this is deliberately NOT full Accounts (no GL,
 * no invoices), just enough structure for Order FMS's own credit-control gate to work off
 * real data instead of a single "advance amount" guess. A future Accounts module can build
 * on these same rows rather than duplicating them.
 */
export const orderPayments = pgTable("order_payments", {
  // Payment_ID, e.g. "OPY-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  orderId: text("order_id").notNull(),
  amount: numeric("amount").notNull(),
  mode: orderPaymentModeEnum("mode").notNull().default("Bank_Transfer"),
  reference: text("reference").notNull().default(""),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  recordedBy: text("recorded_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// OrderActivityRecord.Kind — one row per pipeline event, append-only. Mirrors
// lead_activities' own "a record is read as a timeline, not a single status cell"
// convention exactly.
export const orderActivityKindEnum = pgEnum("order_activity_kind", [
  "Note",
  "Status_Change",
  "Items_Mapped",
  "Payment",
  "Credit_Hold",
  "Credit_Approved",
  "Stock_Reserved",
  "Shortage_Notified",
  "Dispatch_Committed",
  "Cancelled",
]);

export const orderActivities = pgTable("order_activities", {
  // Activity_ID, e.g. "OAC-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  orderId: text("order_id").notNull(),
  kind: orderActivityKindEnum("kind").notNull(),
  message: text("message").notNull(),
  actorId: text("actor_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
