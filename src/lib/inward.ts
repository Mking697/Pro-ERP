import {
  appendModuleRow,
  getModuleRows,
  updateModuleRow,
  findModuleRow,
  recordToRow,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";

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
}

export async function createInwardEntry(input: CreateInwardInput): Promise<InwardRecord> {
  const record: InwardRecord = {
    Entry_ID: generateId("INW"),
    Timestamp: new Date().toISOString(),
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
  };

  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
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
  const found = await findModuleRow<InwardRecord>(MODULE_KEY, 0, input.entryId);
  if (!found) {
    throw new Error("Entry nahi mili.");
  }
  if (found.record.IQC_Status === "Verified") {
    throw new Error("Yeh entry pehle se verify ho chuki hai.");
  }

  const now = new Date().toISOString();
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
  }

  return updated;
}
