import { integer, numeric, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors MODULE_SHEETS' ITEMS, STOCK_LEDGER, INDENTS and BOM — src/lib/inventory/items.ts,
 * ledger.ts, indents.ts and bom.ts.
 */

// ItemRecord.Status — "Active" | "Inactive", same convention confirmed in
// src/app/api/inventory/items/[sku]/route.ts's zod enum.
export const itemStatusEnum = pgEnum("item_status", ["Active", "Inactive"]);

export const items = pgTable("items", {
  // SKU is the real primary key here — items has no separate generated id.
  sku: text("sku").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  itemName: text("item_name").notNull(),
  // ITEM_CATEGORIES (Raw Material/Consumable/Semi-FG/FG) — closed but not itself a
  // Status column, kept text.
  category: text("category").notNull().default(""),
  sizeUnit: text("size_unit").notNull().default(""),
  uom: text("uom").notNull().default(""),
  rate: numeric("rate"),
  adcManual: numeric("adc_manual"),
  leadTimeDays: integer("lead_time_days"),
  safetyFactor: numeric("safety_factor"),
  moq: numeric("moq"),
  maxLevel: numeric("max_level"),
  location: text("location").notNull().default(""),
  status: itemStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull().default(""),
});

export const stockLedger = pgTable("stock_ledger", {
  // Txn_ID, e.g. "TXN-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  sku: text("sku").notNull(),
  // DIRECTIONS ("In" | "Out", src/lib/inventory/constants.ts) — small closed vocabulary,
  // kept text like the other non-Status closed vocabularies in this schema.
  direction: text("direction").notNull(),
  quantity: numeric("quantity").notNull(),
  uom: text("uom").notNull().default(""),
  // LEDGER_SOURCES (Opening/Manual/Form/IQC/Production/Production_Output/Indent_Receipt/
  // Adjustment/FMS) — closed but not a Status column, kept text.
  source: text("source").notNull(),
  referenceId: text("reference_id").notNull().default(""),
  location: text("location").notNull().default(""),
  issuedTo: text("issued_to").notNull().default(""),
  remark: text("remark").notNull().default(""),
  userId: text("user_id").notNull().default(""),
});

// IndentRecord.Status — src/lib/inventory/indents.ts INDENT_STATUSES.
export const indentStatusEnum = pgEnum("indent_status", [
  "Pending",
  "Approved",
  "Ordered",
  "Partially_Received",
  "Received",
  "Cancelled",
]);

export const indents = pgTable("indents", {
  // Indent_ID, e.g. "IND-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  sku: text("sku").notNull(),
  itemName: text("item_name").notNull().default(""),
  suggestedQty: numeric("suggested_qty"),
  finalQty: numeric("final_qty"),
  uom: text("uom").notNull().default(""),
  // INDENT_REASONS ("Reorder" | "Production_Shortage") — closed but not Status, kept text.
  reason: text("reason").notNull().default(""),
  linkedPlanId: text("linked_plan_id").notNull().default(""),
  status: indentStatusEnum("status").notNull().default("Pending"),
  requestedBy: text("requested_by").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  expectedDate: timestamp("expected_date", { withTimezone: true }),
  receivedQty: numeric("received_qty"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
});

// BomRow.Status — "Active" | "Archived", the same versioning convention CLAUDE.md
// documents for BOM re-saves (mirrors FMS_TEMPLATES' own Active/Archived pattern).
export const bomStatusEnum = pgEnum("bom_status", ["Active", "Archived"]);

/**
 * One row per component line, grouped by BOM_ID — the same flat-rows-by-group shape as
 * FMS_TEMPLATES/FMS_RUNS, kept as-is per this phase's instructions (no normalization
 * judgment call here; that's for whoever rewrites bom.ts). No per-row id exists in the
 * source sheet, so the primary key is the natural composite (bom_id, line_no) rather than
 * a new surrogate key.
 */
export const bom = pgTable(
  "bom",
  {
    bomId: text("bom_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    productName: text("product_name").notNull(),
    productSku: text("product_sku").notNull(),
    version: text("version").notNull().default(""),
    lineNo: text("line_no").notNull(),
    componentSku: text("component_sku").notNull(),
    componentName: text("component_name").notNull().default(""),
    // COMPONENT_TYPES ("Item" | "Product") — closed but not Status, kept text.
    componentType: text("component_type").notNull().default("Item"),
    qtyPerUnit: numeric("qty_per_unit"),
    uom: text("uom").notNull().default(""),
    status: bomStatusEnum("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull().default(""),
  },
  (table) => [primaryKey({ columns: [table.bomId, table.lineNo] })]
);
