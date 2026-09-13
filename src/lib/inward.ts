import {
  appendModuleRow,
  ensureModuleHeaders,
  getModuleRows,
  updateModuleRow,
  findModuleRow,
  recordToRow,
} from "@/lib/moduleSheets";
import { recordMovement } from "@/lib/inventory/ledger";
import { findItem } from "@/lib/inventory/items";
import { generateId } from "@/lib/id";
import { formatStamp, nowStamp, parseStamp } from "@/lib/timestamp";
import { emitFmsEvent } from "@/lib/fms/engine";
import { computeDefaultTatDeadline } from "@/lib/fms/calendar";
import { getSetting } from "@/lib/settings";

const DEFAULT_IQC_TAT_VALUE = 24;
const DEFAULT_IQC_TAT_UNIT = "Hours";

const MODULE_KEY = "INWARD_IQC_FMS";
const FAILURE_LOG_KEY = "FAILURE_LOG";
const IMS_INWARD_KEY = "IMS_INWARD";

export interface InwardRecord {
  Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
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

export async function listInwardEntries(): Promise<InwardRecord[]> {
  return getModuleRows<InwardRecord>(MODULE_KEY);
}

/** An entry's IQC check counts as "Not Done" only while it is still Pending and its
 * deadline has passed — a live, timestamp-derived classification, never a status stored
 * in the sheet. Mirrors isOverdue() in src/lib/mis.ts. */
export function isIqcOverdue(entry: InwardRecord): boolean {
  if (entry.IQC_Status !== "Pending" || !entry.IQC_Deadline) return false;
  const deadline = parseStamp(entry.IQC_Deadline);
  return deadline !== null && new Date() > deadline;
}

/** Rejected quantities routed here by submitQualityCheck, newest first. */
export async function listFailureLog(): Promise<FailureLogRecord[]> {
  const rows = await getModuleRows<FailureLogRecord>(FAILURE_LOG_KEY);
  return rows.reverse();
}

/** Accepted quantities routed here by submitQualityCheck, newest first. */
export async function listImsInward(): Promise<ImsInwardRecord[]> {
  const rows = await getModuleRows<ImsInwardRecord>(IMS_INWARD_KEY);
  return rows.reverse();
}

interface CreateInwardInput {
  partyName: string;
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
  // The SKU columns were added after some organizations connected this sheet.
  await ensureModuleHeaders(MODULE_KEY);

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

  const record: InwardRecord = {
    Entry_ID: generateId("INW"),
    Timestamp: nowStamp(),
    Party_Name: input.partyName,
    Invoice_No: input.invoiceNo,
    Inward_Type: input.inwardType,
    Attachment_URL: input.attachmentUrl,
    Remark: input.remark,
    IQC_Status: "Pending",
    Verified_By: "",
    Verified_At: "",
    Verify_Checkbox: "",
    IQC_Pass_Qty: "",
    IQC_Fail_Qty: "",
    Fail_Reason: "",
    SKU: input.sku ?? "",
    Item_Name: input.itemName ?? "",
    Created_By: input.createdBy,
    IQC_TAT_Value: String(tatValue),
    IQC_TAT_Unit: tatUnit,
    IQC_Deadline: formatStamp(new Date(deadlineMs)),
  };

  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));

  // Best-effort: lets an org-defined FMS template react to a new inward entry without
  // touching this module's own IQC flow at all. Mirrors the IQC stock-In write below — a
  // chaining failure must never undo or block the entry that has already saved.
  try {
    await emitFmsEvent("INWARD_ENTRY_CREATED", `${MODULE_KEY}:${record.Entry_ID}`);
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
  await ensureModuleHeaders(MODULE_KEY);
  const found = await findModuleRow<InwardRecord>(MODULE_KEY, 0, input.entryId);
  if (!found) {
    throw new Error("Entry nahi mili.");
  }
  if (found.record.IQC_Status === "Verified") {
    throw new Error("Yeh entry pehle se verify ho chuki hai.");
  }

  const now = nowStamp();
  const updated: InwardRecord = {
    ...found.record,
    IQC_Status: "Verified",
    Verified_By: input.verifiedBy,
    Verified_At: now,
    Verify_Checkbox: input.verifyChecked ? "Yes" : "No",
    IQC_Pass_Qty: String(input.passQty),
    IQC_Fail_Qty: String(input.failQty),
    Fail_Reason: input.failQty > 0 ? input.failReason : "",
  };

  await updateModuleRow(MODULE_KEY, found.rowNumber, recordToRow(MODULE_KEY, updated));

  // Route the outcome: a failed quantity goes to the Failure Log, a passed quantity
  // goes into IMS inventory — both reference the original entry by Linked_Entry_ID.
  if (input.failQty > 0) {
    const failureLog: FailureLogRecord = {
      Log_ID: generateId("FAIL"),
      Linked_Entry_ID: updated.Entry_ID,
      Timestamp: now,
      Party_Name: updated.Party_Name,
      Invoice_No: updated.Invoice_No,
      Inward_Type: updated.Inward_Type,
      Fail_Qty: String(input.failQty),
      Fail_Reason: input.failReason,
      Attachment_URL: updated.Attachment_URL,
      Verified_By: input.verifiedBy,
    };
    await appendModuleRow(FAILURE_LOG_KEY, recordToRow(FAILURE_LOG_KEY, failureLog));
  }

  if (input.passQty > 0) {
    const imsRecord: ImsInwardRecord = {
      Record_ID: generateId("IMS"),
      Linked_Entry_ID: updated.Entry_ID,
      Timestamp: now,
      Party_Name: updated.Party_Name,
      Invoice_No: updated.Invoice_No,
      Inward_Type: updated.Inward_Type,
      Pass_Qty: String(input.passQty),
      Verified_By: input.verifiedBy,
    };
    await appendModuleRow(IMS_INWARD_KEY, recordToRow(IMS_INWARD_KEY, imsRecord));

    // A passed quantity is stock that has physically arrived, so it enters the ledger
    // here rather than waiting for someone to key the same numbers a second time.
    //
    // Only when the entry names an item — an inward recorded without a SKU has nothing
    // to add to. Best-effort: a stock write must never undo a completed quality check,
    // which is already saved above.
    if (updated.SKU) {
      try {
        const item = await findItem(updated.SKU);
        if (item) {
          await recordMovement({
            sku: updated.SKU,
            direction: "In",
            quantity: input.passQty,
            uom: item.UOM,
            source: "IQC",
            referenceId: updated.Entry_ID,
            location: item.Location,
            remark: `IQC pass — ${updated.Party_Name} / ${updated.Invoice_No}`,
            userId: input.verifiedBy,
          });
        }
      } catch (error) {
        console.error(
          `[inward] IQC stock In failed for ${updated.Entry_ID} / ${updated.SKU}:`,
          error
        );
      }
    }
  }

  return updated;
}
