import { index, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors MODULE_SHEETS' INWARD_IQC_FMS, FAILURE_LOG and IMS_INWARD — src/lib/inward.ts.
 */

// InwardRecord.IQC_Status — src/lib/inward.ts: "Pending" on create, "Verified" once
// submitQualityCheck() runs (Pass/Fail routing itself is a separate Qty split, not more
// status values).
export const iqcStatusEnum = pgEnum("iqc_status", ["Pending", "Verified"]);

export const inwardIqcFms = pgTable(
  "inward_iqc_fms",
  {
  // Entry_ID, e.g. "INW-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  partyName: text("party_name").notNull(),
  // Set only when Party_Name was picked from Vendor Master rather than typed free — an
  // inward entry can still name a party that isn't a registered vendor yet, so this is
  // additive, not a replacement for the free-text field. Plain text, not FK-enforced,
  // matching every other cross-entity reference in this schema (vendorItems.vendorId,
  // indents.sku, …).
  vendorId: text("vendor_id").notNull().default(""),
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
  },
  (table) => [index("inward_iqc_fms_org_id_idx").on(table.orgId)]
);

export const failureLog = pgTable(
  "failure_log",
  {
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
    // Set once this failed quantity is accepted "Under Deviation" (a documented quality
    // concession) and written into stock as a real ledger "In" — see
    // src/lib/inward/deviation.ts. Null until then; a failed qty can sit unresolved
    // indefinitely, same as before this feature existed.
    movedToInventoryAt: timestamp("moved_to_inventory_at", { withTimezone: true }),
    // "" until a Debit Note (src/db/schema/accounts.ts's debitNotes) is issued against the
    // vendor for this failure — set once, never cleared, so the UI can show "Debit Note
    // already issued: <no>" and this action stays a one-time thing per failure.
    debitNoteId: text("debit_note_id").notNull().default(""),
    // "Accept Under Deviation" (2026-09-24) — request/approval gate, mirroring
    // src/lib/orders/orders.ts's Credit_Hold approval shape. deviationRequestedAt/By are set
    // together by requestUnderDeviation() and cleared together by rejectUnderDeviation()
    // (back to null/"", so the entry can be re-requested) — no separate audit trail table,
    // same "failure_log has none today, don't add one for just this" judgment call the rest
    // of this table already makes. deviationApprovedBy/At are set once, alongside
    // movedToInventoryAt, by approveUnderDeviation() and never cleared.
    deviationRequestedAt: timestamp("deviation_requested_at", { withTimezone: true }),
    deviationRequestedBy: text("deviation_requested_by").notNull().default(""),
    deviationApprovedBy: text("deviation_approved_by").notNull().default(""),
    deviationApprovedAt: timestamp("deviation_approved_at", { withTimezone: true }),
  },
  (table) => [index("failure_log_org_id_idx").on(table.orgId)]
);

export const imsInward = pgTable(
  "ims_inward",
  {
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
  },
  (table) => [index("ims_inward_org_id_idx").on(table.orgId)]
);
