/**
 * J3 — additive persistence for Recorded Job Cost Sheets (Draft CRUD only; no
 * finalize/lineage-locking/allocation-cap transactional logic lives here — that is J4).
 *
 * Mirrors `src/db/schema/costing.ts`'s shape/conventions for the sibling estimated
 * feature (text PKs, append-only JSONB snapshot, state CHECK, tenant FK). `job_cost_lineages`
 * and `job_cost_source_allocations` are created empty/unused this stage so J4 does not need
 * a second migration — see `docs/job-cost-sheet-implementation.md` section 5.
 */
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";
import type { JobCostCalculation } from "@/lib/job-costing/types";

/** Immutable finalized snapshots; all writers serialize on tenant admission (J3: Draft-only
 * writers exist; a future J4 finalize mutation reuses this same table/state shape). Text
 * references (planId/productSku) intentionally follow the existing domain convention of not
 * being FKs — the service, not the database, proves same-tenant plan/SKU ownership. */
export const jobCostSheets = pgTable(
  "job_cost_sheets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    planId: text("plan_id").notNull(),
    productSku: text("product_sku").notNull(),
    revision: integer("revision").notNull(),
    version: integer("version").notNull(),
    status: text("status").$type<"Draft" | "Finalized">().notNull(),
    calculation: jsonb("calculation").$type<JobCostCalculation>().notNull(),
    supersedesId: text("supersedes_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: text("finalized_by"),
  },
  (t) => [
    uniqueIndex("job_cost_sheets_org_plan_revision_uidx").on(t.orgId, t.planId, t.revision),
    index("job_cost_sheets_org_plan_status_idx").on(t.orgId, t.planId, t.status),
    check(
      "job_cost_sheets_state_check",
      sql`${t.revision} > 0 AND ${t.version} > 0 AND ((${t.status} = 'Draft' AND ${t.finalizedAt} IS NULL AND ${t.finalizedBy} IS NULL) OR (${t.status} = 'Finalized' AND ${t.finalizedAt} IS NOT NULL AND ${t.finalizedBy} IS NOT NULL))`
    ),
  ]
);

/** One active finalized valuation per plan (J4 owns all writes to `activeFinalizedSheetId`
 * and `version`; this stage only creates the empty table so J4 needs no second migration). */
export const jobCostLineages = pgTable(
  "job_cost_lineages",
  {
    orgId: text("org_id").notNull().references(() => organizations.id),
    planId: text("plan_id").notNull(),
    activeFinalizedSheetId: text("active_finalized_sheet_id"),
    version: integer("version").notNull().default(0),
  },
  (t) => [
    uniqueIndex("job_cost_lineages_org_plan_uidx").on(t.orgId, t.planId),
    check("job_cost_lineages_version_check", sql`${t.version} >= 0`),
  ]
);

/** General PO line expense allocations claimed by a finalized sheet (J4 owns all writes;
 * this stage only creates the empty table). `sourceKind` is currently always
 * `GeneralPOLine` per the frozen contract — kept as text, not an enum, to match the rest of
 * this schema's "free text, service validates" convention for evidence identity fields. */
export const jobCostSourceAllocations = pgTable(
  "job_cost_source_allocations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    sheetId: text("sheet_id").notNull(),
    sourceKind: text("source_kind").$type<"GeneralPOLine">().notNull(),
    sourceId: text("source_id").notNull(),
    poId: text("po_id").notNull(),
    planId: text("plan_id").notNull(),
    head: text("head").notNull(),
    allocatedAmount: numeric("allocated_amount", { precision: 15, scale: 2 }).notNull(),
    eligibleCap: numeric("eligible_cap", { precision: 15, scale: 2 }).notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    facts: jsonb("facts").notNull(),
    basis: text("basis").notNull(),
    reason: text("reason").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    uniqueIndex("job_cost_source_allocations_org_sheet_source_uidx").on(t.orgId, t.sheetId, t.sourceKind, t.sourceId),
    index("job_cost_source_allocations_org_source_active_idx").on(t.orgId, t.sourceKind, t.sourceId, t.active),
    check("job_cost_source_allocations_nonnegative_check", sql`${t.allocatedAmount} >= 0 AND ${t.eligibleCap} >= 0 AND ${t.allocatedAmount} <= ${t.eligibleCap}`),
  ]
);
