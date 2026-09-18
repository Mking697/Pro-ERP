import { numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors MODULE_SHEETS' INWARD_IQC_FMS, FAILURE_LOG and IMS_INWARD — src/lib/inward.ts.
 */

// InwardRecord.IQC_Status — src/lib/inward.ts: "Pending" on create, "Verified" once
// submitQualityCheck() runs (Pass/Fail routing itself is a separate Qty split, not more
// status values).
export const iqcStatusEnum = pgEnum("iqc_status", ["Pending", "Verified"]);

export const inwardIqcFms = pgTable("inward_iqc_fms", {
  // Entry_ID, e.g. "INW-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  partyName: text("party_name").notNull(),
  invoiceNo: text("invoice_no").notNull().default(""),
  inwardType: text("inward_type").notNull().default(""),
  attachmentUrl: text("attachment_url").notNull().default(""),
  remark: text("remark").notNull().default(""),
  iqcStatus: iqcStatusEnum("iqc_status").notNull().default("Pending"),
  verifiedBy: text("verified_by").notNull().default(""),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifyCheckbox: text("verify_checkbox").notNull().default(""),
  iqcPassQty: numeric("iqc_pass_qty"),
  iqcFailQty: numeric("iqc_fail_qty"),
  failReason: text("fail_reason").notNull().default(""),
  // Optional link to an inventory item — set, a passed check adds to stock.
  sku: text("sku").notNull().default(""),
  itemName: text("item_name").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  // TAT/deadline for the IQC check, working-hours-aware — computed once at creation.
  iqcTatValue: numeric("iqc_tat_value"),
  iqcTatUnit: text("iqc_tat_unit").notNull().default(""),
  iqcDeadline: timestamp("iqc_deadline", { withTimezone: true }),
});

export const failureLog = pgTable("failure_log", {
  // Log_ID, e.g. "FAIL-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  linkedEntryId: text("linked_entry_id").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  partyName: text("party_name").notNull(),
  invoiceNo: text("invoice_no").notNull().default(""),
  inwardType: text("inward_type").notNull().default(""),
  failQty: numeric("fail_qty").notNull(),
  failReason: text("fail_reason").notNull().default(""),
  attachmentUrl: text("attachment_url").notNull().default(""),
  verifiedBy: text("verified_by").notNull().default(""),
});

export const imsInward = pgTable("ims_inward", {
  // Record_ID, e.g. "IMS-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  linkedEntryId: text("linked_entry_id").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  partyName: text("party_name").notNull(),
  invoiceNo: text("invoice_no").notNull().default(""),
  inwardType: text("inward_type").notNull().default(""),
  passQty: numeric("pass_qty").notNull(),
  verifiedBy: text("verified_by").notNull().default(""),
});
