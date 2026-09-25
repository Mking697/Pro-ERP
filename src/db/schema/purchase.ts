import { index, numeric, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * The hardcoded Purchase flow: Indent Approve (already lives on `indents`) -> PO Issue ->
 * Follow Up -> Material Received. One Purchase Order always binds to exactly one Vendor,
 * bundling every Approved indent that vendor can fulfil — see src/lib/purchase/orders.ts.
 *
 * `vendorId`/`indentId`/`sku` below are plain text, not FK-enforced, matching every other
 * cross-entity reference in this schema (see parties.ts's vendorItems doc comment for why).
 */
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "Open",
  "Completed",
  "Cancelled",
]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
  // PO_ID, e.g. "PO-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: text("vendor_id").notNull(),
  status: purchaseOrderStatusEnum("status").notNull().default("Open"),
  // The PO document itself, uploaded at Issue time.
  attachmentUrl: text("attachment_url").notNull().default(""),
  // Uploaded at Material Received time — one invoice per PO for now, not per receipt.
  invoiceUrl: text("invoice_url").notNull().default(""),
  issuedBy: text("issued_by").notNull().default(""),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  // Both computed once at Issue time from the slowest (max) lead time among this PO's
  // items, working-hours-aware — see src/lib/purchase/orders.ts's computePoDeadlines().
  followUpDueAt: timestamp("follow_up_due_at", { withTimezone: true }),
  followUpDoneBy: text("follow_up_done_by").notNull().default(""),
  followUpDoneAt: timestamp("follow_up_done_at", { withTimezone: true }),
  followUpRemark: text("follow_up_remark").notNull().default(""),
  materialReceivedDueAt: timestamp("material_received_due_at", { withTimezone: true }),
  // Snapshotted at Issue time from Purchase Setup's own defaults (or a per-PO override
  // chosen on the PO Issue screen) — a real, once-issued PO must keep printing the GST%/
  // Terms/Note that actually applied, not re-derive them live if an Admin edits the
  // default afterward. Same "snapshot, not live-read" convention as oldPrice/newPrice
  // below and invoices.gstAmount in accounts.ts.
  gstPercent: numeric("gst_percent").notNull().default("0"),
  termsAndConditions: text("terms_and_conditions").notNull().default(""),
  note: text("note").notNull().default(""),
  },
  (table) => [index("purchase_orders_org_id_idx").on(table.orgId)]
);

/**
 * One row per indent bundled into a PO — the price is snapshotted here, not read live off
 * `vendor_items`, so a vendor's price changing later never rewrites what was actually
 * agreed on an already-issued PO.
 */
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    // PO_Line_ID, e.g. "POL-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    poId: text("po_id").notNull(),
    indentId: text("indent_id").notNull(),
    sku: text("sku").notNull(),
    // What vendor_items.unitPrice said at the moment this PO was issued.
    oldPrice: numeric("old_price"),
    // What the purchaser actually agreed — defaults to oldPrice if left blank.
    newPrice: numeric("new_price"),
  },
  (table) => [
    unique("purchase_order_lines_po_indent_unique").on(table.poId, table.indentId),
    index("purchase_order_lines_org_id_idx").on(table.orgId),
  ]
);
