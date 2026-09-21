import { numeric, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors MODULE_SHEETS' PRODUCTION_PLANS and PLAN_MATERIALS — src/lib/inventory/plans.ts.
 */

// ProductionPlanRecord.Status — src/lib/inventory/plans.ts PLAN_STATUSES.
export const planStatusEnum = pgEnum("plan_status", [
  "Ready",
  "Shortage",
  "In_Production",
  "Completed",
  "Cancelled",
]);

export const productionPlans = pgTable("production_plans", {
  // Plan_ID, e.g. "PLN-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  productName: text("product_name").notNull(),
  productSku: text("product_sku").notNull(),
  bomId: text("bom_id").notNull().default(""),
  bomVersion: text("bom_version").notNull().default(""),
  plannedQty: numeric("planned_qty").notNull(),
  productionDate: timestamp("production_date", { withTimezone: true }),
  status: planStatusEnum("status").notNull().default("Ready"),
  actualQty: numeric("actual_qty"),
  startedBy: text("started_by").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // User-facing identifier, separate from the real key (Plan_ID/id above).
  jobNo: text("job_no").notNull().default(""),
  // Free text, e.g. a customer's PO number — not validated (no Sales Order module yet).
  orderNo: text("order_no").notNull().default(""),
  // Which FMS Template ("Line") Start Production should run for this plan. Blank means no
  // Line runs for this plan — there is deliberately no broadcast fallback that fires every
  // Active PRODUCTION_STARTED template instead (that used to be the behavior and was
  // dropped: two products each needing a different Line would both fire for any plan that
  // hadn't picked one, which is exactly the ambiguity picking a Line exists to remove).
  fmsTemplateId: text("fms_template_id").notNull().default(""),
});

// PlanMaterialRecord.Status — src/lib/inventory/plans.ts: "Allocated" | "Shortage" (set
// by the allocator), then "Consumed" once Start Production writes the Out rows.
export const planMaterialStatusEnum = pgEnum("plan_material_status", [
  "Allocated",
  "Shortage",
  "Consumed",
]);

/**
 * One row per material line, grouped by Plan_ID — no per-row id in the source sheet, so
 * the primary key is the natural composite (plan_id, sku): a plan lists a given component
 * at most once.
 */
export const planMaterials = pgTable(
  "plan_materials",
  {
    planId: text("plan_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    sku: text("sku").notNull(),
    itemName: text("item_name").notNull().default(""),
    qtyPerUnit: numeric("qty_per_unit"),
    requiredQty: numeric("required_qty"),
    // Missing from the first pass of this schema (caught during Phase 3 live testing
    // against the shared-pool allocation scenario) — MODULE_SHEETS' PLAN_MATERIALS always
    // had this column. A plan snapshots its BOM specifically so a later BOM edit can't
    // rewrite history (see bomId/bomVersion on production_plans); storing UOM directly
    // here, snapshotted at allocation time, preserves that same guarantee. Deriving it by
    // joining back to the bom table at read time (the interim workaround) would still be
    // *correct* today since bom rows are archived, never deleted — but it's needless
    // coupling this column removes.
    uom: text("uom").notNull().default(""),
    allocatedQty: numeric("allocated_qty"),
    shortageQty: numeric("shortage_qty"),
    consumedQty: numeric("consumed_qty"),
    status: planMaterialStatusEnum("status").notNull().default("Shortage"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.planId, table.sku] })]
);
