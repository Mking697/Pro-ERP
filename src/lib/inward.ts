import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { inwardIqcFms, failureLog, imsInward } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { recordMovement } from "@/lib/inventory/ledger";
import { findItem } from "@/lib/inventory/items";
import { emitFmsEvent } from "@/lib/fms/engine";
import { computeDefaultTatDeadline } from "@/lib/fms/calendar";
import { getSetting } from "@/lib/settings";
import { parseStamp } from "@/lib/timestamp";

const DEFAULT_IQC_TAT_VALUE = 24;
const DEFAULT_IQC_TAT_UNIT = "Hours";

/**
 * The one user (or "" if unset) who may approve/reject an "Accept Under Deviation" request
 * (src/lib/inward/deviation.ts) — an Admin can always approve/reject too, same as
 * src/lib/orders/settings.ts's creditHoldApprover / approveCreditHold shape this mirrors.
 * Persisted as one more key in the plain settings table, alongside INWARD_IQC_TAT_VALUE/
 * _UNIT — surfaced on the same "Inward IQC" admin settings screen
 * (src/app/admin/settings/inward-iqc-tat-form.tsx).
 */
export async function getIqcDeviationApprover(): Promise<string> {
  const value = await getSetting("INWARD_IQC_DEVIATION_APPROVER");
  return value ?? "";
}

// Context_Ref prefix an FMS template's Trigger_Event ("INWARD_ENTRY_CREATED") resolves
// against — src/lib/fms/reference.ts and src/lib/fms/dataSourceResolver.ts both split on
// this exact string, so it must stay "INWARD_IQC_FMS", the old Sheets-era module key, not
// "INWARD". Nothing else about this constant is meaningful anymore now that the table
// isn't looked up by module key — it exists purely so the Context_Ref convention doesn't
// drift out from under FMS, which this migration is explicitly not allowed to touch.
const CONTEXT_REF_PREFIX = "INWARD_IQC_FMS";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `inward_iqc_fms` Postgres
 * table — the goal is zero changes at the API routes and the `/inward` frontend, which
 * all read `.Entry_ID`, `.IQC_Status`, etc. off this type today.
 */
export interface InwardRecord {
  Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  /** Set only when Party_Name was picked from Vendor Master, not typed free. */
  Vendor_ID: string;
  Invoice_No: string;
  Inward_Type: string;
  Attachment_URL: string;
  Remark: string;
  IQC_Status: string;
  Verified_By: string;
  Verified_At: string;
  Verify_Checkbox: string;
  IQC_Pass_Qty: string;
  IQC_Fail_Qty: string;
  Fail_Reason: string;
  /** Optional link to an inventory item — set, a passed check adds to stock. */
  SKU: string;
  Item_Name: string;
  /** Who raised this entry. Blank on rows written before the column existed. */
  Created_By: string;
  /** TAT/deadline the IQC check should finish within — computed once at creation from
   * Settings ("INWARD_IQC_TAT_VALUE"/"_UNIT"), working-hours-aware. Purely additive:
   * IQC_Status, Verified_By and the Pass/Fail routing below are unchanged by this. */
  IQC_TAT_Value: string;
  IQC_TAT_Unit: string;
  IQC_Deadline: string;
}

export interface FailureLogRecord {
  Log_ID: string;
  Linked_Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  Invoice_No: string;
  Inward_Type: string;
  Fail_Qty: string;
  Fail_Reason: string;
  Attachment_URL: string;
  Verified_By: string;
  /** "" until "Accept Under Deviation" (src/lib/inward/deviation.ts) moves this failed
   * quantity into real stock — idempotency guard, also what the UI disables its own button
   * on. */
  Moved_To_Inventory_At: string;
  /** "" until a Debit Note (src/lib/accounts/debitNotes.ts) is issued against this entry —
   * same idempotency purpose as Moved_To_Inventory_At, independent of it. */
  Debit_Note_ID: string;
  /** The LINKED inward_iqc_fms row's own Vendor_ID (failure_log carries no vendor column
   * of its own) — lets the "Issue Debit Note" dialog show the vendor read-only when the
   * original inward entry already named one from Vendor Master, instead of always asking
   * again. "" when that inward entry named a party that isn't a registered vendor. */
  Linked_Vendor_ID: string;
  /** "" until an IQC_CHECK holder requests "Accept Under Deviation" (src/lib/inward/
   * deviation.ts's requestUnderDeviation()) — the UI's "Pending Approval" state. Cleared
   * back to "" by rejectUnderDeviation() so the entry can be re-requested; set for good by
   * approveUnderDeviation() alongside Moved_To_Inventory_At. */
  Deviation_Requested_At: string;
  Deviation_Requested_By: string;
}

export interface ImsInwardRecord {
  Record_ID: string;
  Linked_Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  Invoice_No: string;
  Inward_Type: string;
  Pass_Qty: string;
  Verified_By: string;
}

type InwardRow = InferSelectModel<typeof inwardIqcFms>;
type FailureLogRow = InferSelectModel<typeof failureLog>;
type ImsInwardRow = InferSelectModel<typeof imsInward>;

function rowToRecord(row: InwardRow): InwardRecord {
  return {
    Entry_ID: row.id,
    Timestamp: row.timestamp.toISOString(),
    Party_Name: row.partyName,
    Vendor_ID: row.vendorId,
    Invoice_No: row.invoiceNo,
    Inward_Type: row.inwardType,
    Attachment_URL: row.attachmentUrl,
    Remark: row.remark,
    IQC_Status: row.iqcStatus,
    Verified_By: row.verifiedBy,
    Verified_At: row.verifiedAt ? row.verifiedAt.toISOString() : "",
    Verify_Checkbox: row.verifyCheckbox,
    IQC_Pass_Qty: row.iqcPassQty ?? "",
    IQC_Fail_Qty: row.iqcFailQty ?? "",
    Fail_Reason: row.failReason,
    SKU: row.sku,
    Item_Name: row.itemName,
    Created_By: row.createdBy,
    IQC_TAT_Value: row.iqcTatValue ?? "",
    IQC_TAT_Unit: row.iqcTatUnit,
    IQC_Deadline: row.iqcDeadline ? row.iqcDeadline.toISOString() : "",
  };
}

function failureLogFromRow(row: FailureLogRow, linkedVendorId: string): FailureLogRecord {
  return {
    Log_ID: row.id,
    Linked_Entry_ID: row.linkedEntryId,
    Timestamp: row.timestamp.toISOString(),
    Party_Name: row.partyName,
    Invoice_No: row.invoiceNo,
    Inward_Type: row.inwardType,
    Fail_Qty: row.failQty,
    Fail_Reason: row.failReason,
    Attachment_URL: row.attachmentUrl,
    Verified_By: row.verifiedBy,
    Moved_To_Inventory_At: row.movedToInventoryAt ? row.movedToInventoryAt.toISOString() : "",
    Debit_Note_ID: row.debitNoteId,
    Linked_Vendor_ID: linkedVendorId,
    Deviation_Requested_At: row.deviationRequestedAt ? row.deviationRequestedAt.toISOString() : "",
    Deviation_Requested_By: row.deviationRequestedBy,
  };
}

function imsInwardFromRow(row: ImsInwardRow): ImsInwardRecord {
  return {
    Record_ID: row.id,
    Linked_Entry_ID: row.linkedEntryId,
    Timestamp: row.timestamp.toISOString(),
    Party_Name: row.partyName,
    Invoice_No: row.invoiceNo,
    Inward_Type: row.inwardType,
    Pass_Qty: row.passQty,
    Verified_By: row.verifiedBy,
  };
}

export async function listInwardEntries(): Promise<InwardRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(inwardIqcFms, orgId);
  return rows.map(rowToRecord);
}

/** An entry's IQC check counts as "Not Done" only while it is still Pending and its
 * deadline has passed — a live, timestamp-derived classification, never a status stored
 * in the table. Mirrors isOverdue() in src/lib/mis.ts. */
export function isIqcOverdue(entry: InwardRecord): boolean {
  if (entry.IQC_Status !== "Pending" || !entry.IQC_Deadline) return false;
  const deadline = parseStamp(entry.IQC_Deadline);
  return deadline !== null && new Date() > deadline;
}

/** Rejected quantities routed here by submitQualityCheck, newest first. */
export async function listFailureLog(): Promise<FailureLogRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(failureLog, orgId);

  // One batched lookup of every linked inward_iqc_fms row (for Linked_Vendor_ID) instead of
  // one query per failure row.
  const linkedIds = [...new Set(rows.map((r) => r.linkedEntryId).filter(Boolean))];
  const linkedRows =
    linkedIds.length > 0
      ? await db.select().from(inwardIqcFms).where(and(eq(inwardIqcFms.orgId, orgId), inArray(inwardIqcFms.id, linkedIds)))
      : [];
  const vendorIdByEntryId = new Map(linkedRows.map((r) => [r.id, r.vendorId]));

  return rows
    .slice()
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .map((row) => failureLogFromRow(row, vendorIdByEntryId.get(row.linkedEntryId) ?? ""));
}

/** Accepted quantities routed here by submitQualityCheck, newest first. */
export async function listImsInward(): Promise<ImsInwardRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(imsInward, orgId);
  return rows
    .slice()
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .map(imsInwardFromRow);
}

interface CreateInwardInput {
  partyName: string;
  /** Set only when the party was picked from Vendor Master rather than typed free. */
  vendorId?: string;
  invoiceNo: string;
  inwardType: string;
  attachmentUrl: string;
  remark: string;
  /** Optional: naming an item is what lets the passed quantity reach stock. */
  sku?: string;
  itemName?: string;
  /** The user id of whoever raised it — matches what the quality check stores. */
  createdBy: string;
}

export async function createInwardEntry(input: CreateInwardInput): Promise<InwardRecord> {
  const orgId = await getTenantOrgId();

  // How long IQC has to verify this entry — an Admin-configured company default (Settings),
  // not per-user, since nobody in particular is assigned an inward entry. Computed once
  // here, working-hours-aware, exactly like an FMS step's deadline — see computeDefaultTatDeadline.
  const [tatValueRaw, tatUnitRaw] = await Promise.all([
    getSetting("INWARD_IQC_TAT_VALUE"),
    getSetting("INWARD_IQC_TAT_UNIT"),
  ]);
  const tatValue = Number(tatValueRaw) > 0 ? Number(tatValueRaw) : DEFAULT_IQC_TAT_VALUE;
  const tatUnit = tatUnitRaw === "Days" ? "Days" : DEFAULT_IQC_TAT_UNIT;
  const deadlineMs = await computeDefaultTatDeadline(Date.now(), tatValue, tatUnit);

  const row = await insertRecord(inwardIqcFms, {
    id: generateId("INW"),
    orgId,
    partyName: input.partyName,
    vendorId: input.vendorId ?? "",
    invoiceNo: input.invoiceNo,
    inwardType: input.inwardType,
    attachmentUrl: input.attachmentUrl,
    remark: input.remark,
    iqcStatus: "Pending",
    verifiedBy: "",
    verifiedAt: null,
    verifyCheckbox: "",
    iqcPassQty: null,
    iqcFailQty: null,
    failReason: "",
    sku: input.sku ?? "",
    itemName: input.itemName ?? "",
    createdBy: input.createdBy,
    iqcTatValue: String(tatValue),
    iqcTatUnit: tatUnit,
    iqcDeadline: new Date(deadlineMs),
  });
  const record = rowToRecord(row);

  // Best-effort: lets an org-defined FMS template react to a new inward entry without
  // touching this module's own IQC flow at all. Mirrors the IQC stock-In write below — a
  // chaining failure must never undo or block the entry that has already saved.
  try {
    await emitFmsEvent("INWARD_ENTRY_CREATED", `${CONTEXT_REF_PREFIX}:${record.Entry_ID}`);
  } catch (error) {
    console.error(`[inward] FMS event emit failed for ${record.Entry_ID}:`, error);
  }

  return record;
}

interface QualityCheckInput {
  entryId: string;
  verifiedBy: string;
  verifyChecked: boolean;
  passQty: number;
  failQty: number;
  failReason: string;
}

export async function submitQualityCheck(input: QualityCheckInput): Promise<InwardRecord> {
  const orgId = await getTenantOrgId();
  const found = await findById(inwardIqcFms, orgId, input.entryId);
  if (!found) {
    throw new Error("Entry nahi mili.");
  }
  if (found.iqcStatus === "Verified") {
    throw new Error("Yeh entry pehle se verify ho chuki hai.");
  }

  const now = new Date();
  const updated = await updateById(inwardIqcFms, orgId, input.entryId, {
    iqcStatus: "Verified",
    verifiedBy: input.verifiedBy,
    verifiedAt: now,
    verifyCheckbox: input.verifyChecked ? "Yes" : "No",
    iqcPassQty: String(input.passQty),
    iqcFailQty: String(input.failQty),
    failReason: input.failQty > 0 ? input.failReason : "",
  });
  if (!updated) {
    throw new Error("Entry nahi mili.");
  }
  const record = rowToRecord(updated);

  // Route the outcome: a failed quantity goes to the Failure Log, a passed quantity
  // goes into IMS inventory — both reference the original entry by Linked_Entry_ID.
  if (input.failQty > 0) {
    await insertRecord(failureLog, {
      id: generateId("FAIL"),
      orgId,
      linkedEntryId: record.Entry_ID,
      timestamp: now,
      partyName: record.Party_Name,
      invoiceNo: record.Invoice_No,
      inwardType: record.Inward_Type,
      failQty: String(input.failQty),
      failReason: input.failReason,
      attachmentUrl: record.Attachment_URL,
      verifiedBy: input.verifiedBy,
    });
  }

  if (input.passQty > 0) {
    await insertRecord(imsInward, {
      id: generateId("IMS"),
      orgId,
      linkedEntryId: record.Entry_ID,
      timestamp: now,
      partyName: record.Party_Name,
      invoiceNo: record.Invoice_No,
      inwardType: record.Inward_Type,
      passQty: String(input.passQty),
      verifiedBy: input.verifiedBy,
    });

    // A passed quantity is stock that has physically arrived, so it enters the ledger
    // here rather than waiting for someone to key the same numbers a second time.
    //
    // Only when the entry names an item — an inward recorded without a SKU has nothing
    // to add to. Best-effort: a stock write must never undo a completed quality check,
    // which is already saved above.
    if (record.SKU) {
      try {
        const item = await findItem(record.SKU);
        if (item) {
          await recordMovement({
            sku: record.SKU,
            direction: "In",
            quantity: input.passQty,
            uom: item.UOM,
            source: "IQC",
            referenceId: record.Entry_ID,
            location: item.Location,
            remark: `IQC pass — ${record.Party_Name} / ${record.Invoice_No}`,
            userId: input.verifiedBy,
          });
        }
      } catch (error) {
        console.error(
          `[inward] IQC stock In failed for ${record.Entry_ID} / ${record.SKU}:`,
          error
        );
      }
    }
  }

  return record;
}
