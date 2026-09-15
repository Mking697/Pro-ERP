import { appendModuleRow, appendModuleRows, getModuleRows, recordToRow } from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { nowStamp } from "@/lib/timestamp";

const MODULE_KEY = "VENDORS";

/** One row of the vendor master. Only Vendor_Name is ever required — everything else is
 * optional contact/banking detail a purchase flow can fill in over time. */
export interface VendorRecord {
  Vendor_ID: string;
  Vendor_Name: string;
  Contact_Person: string;
  Phone: string;
  Email: string;
  GSTIN: string;
  Address: string;
  City: string;
  State: string;
  Payment_Terms: string;
  Bank_Name: string;
  Bank_Account_No: string;
  IFSC: string;
  Status: string;
  Created_At: string;
  Created_By: string;
}

export async function listVendors(): Promise<VendorRecord[]> {
  return getModuleRows<VendorRecord>(MODULE_KEY);
}

/** Vendor_ID is generated, so there's nothing to collide on — but two rows named the same
 * is still worth a heads-up (easy to create by accident, e.g. re-adding a vendor who's
 * already there). Case/space-insensitive so "ABC Traders" and "abc traders " still match.
 * Never blocks the save, only flags it. */
function duplicateNameWarning(name: string, existingNames: string[]): string | null {
  const normalized = name.trim().toLowerCase();
  return existingNames.some((n) => n.trim().toLowerCase() === normalized)
    ? `"${name.trim()}" naam se ek Vendor pehle se bana hua hai.`
    : null;
}

/** The optional fields shared by a single manual add and one row of a bulk import. */
interface VendorFields {
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  paymentTerms?: string;
  bankName?: string;
  bankAccountNo?: string;
  ifsc?: string;
}

function buildRecord(vendorName: string, fields: VendorFields, createdBy: string): VendorRecord {
  return {
    Vendor_ID: generateId("VEN"),
    Vendor_Name: vendorName.trim(),
    Contact_Person: fields.contactPerson?.trim() ?? "",
    Phone: fields.phone?.trim() ?? "",
    Email: fields.email?.trim() ?? "",
    GSTIN: fields.gstin?.trim() ?? "",
    Address: fields.address?.trim() ?? "",
    City: fields.city?.trim() ?? "",
    State: fields.state?.trim() ?? "",
    Payment_Terms: fields.paymentTerms?.trim() ?? "",
    Bank_Name: fields.bankName?.trim() ?? "",
    Bank_Account_No: fields.bankAccountNo?.trim() ?? "",
    IFSC: fields.ifsc?.trim() ?? "",
    Status: "Active",
    Created_At: nowStamp(),
    Created_By: createdBy,
  };
}

export interface CreateVendorInput extends VendorFields {
  vendorName: string;
  createdBy: string;
}

export interface CreateVendorResult {
  vendor: VendorRecord;
  warning: string | null;
}

export async function createVendor(input: CreateVendorInput): Promise<CreateVendorResult> {
  if (!input.vendorName.trim()) {
    throw new Error("Vendor ka naam zaroori hai.");
  }

  const existing = await listVendors();
  const warning = duplicateNameWarning(input.vendorName, existing.map((v) => v.Vendor_Name));

  const record = buildRecord(input.vendorName, input, input.createdBy);
  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return { vendor: record, warning };
}

export interface BulkCreateVendorRowInput extends VendorFields {
  /** 1-based row number in the uploaded file (header row is 1), only for error messages. */
  row: number;
  vendorName: string;
}

export interface BulkCreateVendorResult {
  created: { row: number; vendor: VendorRecord }[];
  errors: { row: number; message: string }[];
  /** Rows created despite matching a name already in the sheet, or repeated within the
   * same file — still created, just flagged, same as the manual-add dialog's warning. */
  warnings: { row: number; message: string }[];
}

/**
 * Creates many vendors from one uploaded spreadsheet in a single Sheets write — same
 * shape as createItemsBulk(), minus the SKU-uniqueness bookkeeping: Vendor_ID is a
 * generated key nobody types, not a join key a person retypes across sheets, so there is
 * nothing to collide on.
 */
export async function createVendorsBulk(
  inputs: BulkCreateVendorRowInput[],
  createdBy: string
): Promise<BulkCreateVendorResult> {
  const created: { row: number; vendor: VendorRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];
  const rows: (string | number)[][] = [];

  const seenNames = (await listVendors()).map((v) => v.Vendor_Name);

  for (const input of inputs) {
    if (!input.vendorName.trim()) {
      errors.push({ row: input.row, message: "Vendor ka naam zaroori hai." });
      continue;
    }

    const warning = duplicateNameWarning(input.vendorName, seenNames);
    if (warning) warnings.push({ row: input.row, message: warning });

    const record = buildRecord(input.vendorName, input, createdBy);
    created.push({ row: input.row, vendor: record });
    rows.push(recordToRow(MODULE_KEY, record));
    seenNames.push(record.Vendor_Name); // so duplicates within the same file are caught too
  }

  if (rows.length > 0) {
    await appendModuleRows(MODULE_KEY, rows);
  }

  return { created, errors, warnings };
}
