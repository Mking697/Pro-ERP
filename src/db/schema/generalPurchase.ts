import { index, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Independent / General Purchase Order (2026-10-19) — a second, deliberately separate PO
 * flow alongside purchase.ts's Indent-bound one, for anything bought that isn't a
 * raw-material/consumable SKU tracked through Indent Approve (assets, services, one-off
 * items): free-text line items, any Active vendor, no `vendor_items`/Items-master SKU
 * requirement. Mirrors `purchase_orders`' own 3-step Issue -> Follow Up -> Material
 * Received shape (see src/lib/purchase/generalOrders.ts) so the two flows feel familiar
 * side by side, but this one never touches `stock_ledger` — nothing bought here is
 * inventory. Like `purchase_orders.id`, the real key IS the user-facing document number
 * (random, "GPO-xxxx") — no separate sequential `po_no` column, matching the sibling
 * table's own convention rather than inventing a second numbering scheme.
 */
export const generalPurchaseOrderStatusEnum = pgEnum("general_purchase_order_status", [
  "Open",
  "Completed",
  "Cancelled",
]);

export const generalPurchaseOrders = pgTable(
  "general_purchase_orders",
  {
  // GPO_ID, e.g. "GPO-xxxx" — also the document number shown to the user.
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: text("vendor_id").notNull(),
  // Which Production Plan ("Job Order" per the user's own terminology — production_plans
  // already carries a user-facing jobNo) this purchase is for — "" means a general
  // overhead/office purchase, not tied to any job. Plain text, not FK-enforced, same
  // convention as indents.linkedPlanId (src/db/schema/inventory.ts).
  planId: text("plan_id").notNull().default(""),
  status: generalPurchaseOrderStatusEnum("status").notNull().default("Open"),
  attachmentUrl: text("attachment_url").notNull().default(""),
  invoiceUrl: text("invoice_url").notNull().default(""),
  issuedBy: text("issued_by").notNull().default(""),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  // Entered by the purchaser at Issue time (there is no vendor_items lead-time for an
  // arbitrary, non-SKU purchase to derive this from) and turned into a real deadline via
  // the same working-hours-aware computeDefaultTatDeadline() the raw-material PO flow
  // uses — see src/lib/purchase/generalOrders.ts.
  expectedDeliveryDays: numeric("expected_delivery_days").notNull().default("0"),
  followUpDueAt: timestamp("follow_up_due_at", { withTimezone: true }),
  followUpDoneBy: text("follow_up_done_by").notNull().default(""),
  followUpDoneAt: timestamp("follow_up_done_at", { withTimezone: true }),
  followUpRemark: text("follow_up_remark").notNull().default(""),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  receivedBy: text("received_by").notNull().default(""),
  gstPercent: numeric("gst_percent").notNull().default("0"),
  termsAndConditions: text("terms_and_conditions").notNull().default(""),
  note: text("note").notNull().default(""),
  },
  (table) => [
    index("general_purchase_orders_org_id_idx").on(table.orgId),
    // jobCostingForPlan() filters (org_id, plan_id) on every Job Costing report call.
    index("general_purchase_orders_org_id_plan_id_idx").on(table.orgId, table.planId),
  ]
);

/**
 * One free-text line per item/service — no SKU, no Items-master link, unlike
 * purchase_order_lines (which binds to an Indent). `receivedQty` is null until Material
 * Received marks it; a null receivedQty means "not yet received", distinct from a
 * genuine 0 (e.g. a cancelled/rejected line), same "blank is meaningful" convention
 * items.ts's own doc comment documents for planning fields.
 */
export const generalPurchaseOrderLines = pgTable(
  "general_purchase_order_lines",
  {
    // GPOL_ID, e.g. "GPOL-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    poId: text("po_id").notNull(),
    particular: text("particular").notNull().default(""),
    description: text("description").notNull().default(""),
    uom: text("uom").notNull().default(""),
    qty: numeric("qty").notNull().default("0"),
    rate: numeric("rate").notNull().default("0"),
    // qty * rate, rounded once here — nothing downstream re-derives it, same convention
    // as quotation_items.amount.
    amount: numeric("amount").notNull().default("0"),
    receivedQty: numeric("received_qty"),
  },
  (table) => [
    index("general_purchase_order_lines_org_id_po_id_idx").on(table.orgId, table.poId),
  ]
);
