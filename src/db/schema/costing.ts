import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./platform";
import type { CostCalculation } from "@/lib/costing/types";
/** Immutable finalized snapshots; all writers serialize on tenant admission. Text
 * references intentionally follow existing domain conventions; service validates tenant. */
export const costSheets = pgTable("cost_sheets", {
 id: text("id").primaryKey(), orgId: text("org_id").notNull().references(() => organizations.id),
 productSku: text("product_sku").notNull(), productName: text("product_name").notNull(),
 revision: integer("revision").notNull(), version: integer("version").notNull(), status: text("status").$type<"Draft" | "Finalized">().notNull(),
 calculation: jsonb("calculation").$type<CostCalculation>().notNull(), supersedesId: text("supersedes_id"),
 createdAt: timestamp("created_at",{withTimezone:true}).notNull(), createdBy: text("created_by").notNull(), updatedAt: timestamp("updated_at",{withTimezone:true}).notNull(),
 finalizedAt: timestamp("finalized_at",{withTimezone:true}), finalizedBy: text("finalized_by"),
}, t => [uniqueIndex("cost_sheets_org_product_revision_uidx").on(t.orgId,t.productSku,t.revision), index("cost_sheets_org_status_idx").on(t.orgId,t.status), check("cost_sheets_state_check",sql`${t.revision} > 0 AND ${t.version} > 0 AND ((${t.status} = 'Draft' AND ${t.finalizedAt} IS NULL AND ${t.finalizedBy} IS NULL) OR (${t.status} = 'Finalized' AND ${t.finalizedAt} IS NOT NULL AND ${t.finalizedBy} IS NOT NULL))`)]);
/** Approval history is append-only. No update/delete application API exists. */
export const standardCostRates = pgTable("standard_cost_rates", {
 id: text("id").primaryKey(), orgId: text("org_id").notNull().references(() => organizations.id), sku: text("sku").notNull(), uom: text("uom").notNull(),
 rate: numeric("rate",{precision:15,scale:6}).notNull(), effectiveDate: date("effective_date").notNull(), reason: text("reason").notNull(), approvedBy: text("approved_by").notNull(), approvedAt: timestamp("approved_at",{withTimezone:true}).notNull(),
},t => [index("standard_cost_rates_org_sku_date_idx").on(t.orgId,t.sku,t.effectiveDate),check("standard_cost_rates_nonnegative_check",sql`${t.rate} >= 0`)]);
