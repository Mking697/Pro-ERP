import type { InferSelectModel } from "drizzle-orm";
import { vendors } from "@/db/schema";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `vendors` Postgres table — the
 * goal is zero changes at the API routes and the `/parties` frontend, which both read
 * `.Vendor_Name`, `.Contact_Person`, etc. off this type today.
 */
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

type VendorRow = InferSelectModel<typeof vendors>;

function rowToRecord(row: VendorRow): VendorRecord {
  return {
    Vendor_ID: row.id,
    Vendor_Name: row.vendorName,
    Contact_Person: row.contactPerson,
    Phone: row.phone,
    Email: row.email,
    GSTIN: row.gstin,
    Address: row.address,
    City: row.city,
    State: row.state,
    Payment_Terms: row.paymentTerms,
    Bank_Name: row.bankName,
    Bank_Account_No: row.bankAccountNo,
    IFSC: row.ifsc,
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
    Created_By: row.createdBy,
  };
}

export async function listVendors(): Promise<VendorRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(vendors, orgId);
  return rows.map(rowToRecord);
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

async function insertVendor(
  orgId: string,
  vendorName: string,
  fields: VendorFields,
  createdBy: string
): Promise<VendorRecord> {
  const row = await insertRecord(vendors, {
    id: generateId("VEN"),
    orgId,
    vendorName: vendorName.trim(),
    contactPerson: fields.contactPerson?.trim() ?? "",
    phone: fields.phone?.trim() ?? "",
    email: fields.email?.trim() ?? "",
    gstin: fields.gstin?.trim() ?? "",
    address: fields.address?.trim() ?? "",
    city: fields.city?.trim() ?? "",
    state: fields.state?.trim() ?? "",
    paymentTerms: fields.paymentTerms?.trim() ?? "",
    bankName: fields.bankName?.trim() ?? "",
    bankAccountNo: fields.bankAccountNo?.trim() ?? "",
    ifsc: fields.ifsc?.trim() ?? "",
    status: "Active",
    createdBy,
  });
  return rowToRecord(row);
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

  const orgId = await getTenantOrgId();
  const existing = await listByOrg(vendors, orgId);
  const warning = duplicateNameWarning(input.vendorName, existing.map((v) => v.vendorName));

  const vendor = await insertVendor(orgId, input.vendorName, input, input.createdBy);
  return { vendor, warning };
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
 * Creates many vendors from one uploaded spreadsheet — same shape as
 * createItemsBulk()/createCustomersBulk(), minus any uniqueness bookkeeping: Vendor_ID is a
 * generated key nobody types, not a join key a person retypes across sheets, so there is
 * nothing to collide on. Each row is its own insert (no bulk-insert primitive in repo.ts
 * yet), but that is still one row-per-row round trip to Postgres rather than a full-sheet
 * rewrite, so there is no equivalent of the old single-Sheets-call batching to preserve.
 */
export async function createVendorsBulk(
  inputs: BulkCreateVendorRowInput[],
  createdBy: string
): Promise<BulkCreateVendorResult> {
  const created: { row: number; vendor: VendorRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];

  const orgId = await getTenantOrgId();
  const seenNames = (await listByOrg(vendors, orgId)).map((v) => v.vendorName);

  for (const input of inputs) {
    if (!input.vendorName.trim()) {
      errors.push({ row: input.row, message: "Vendor ka naam zaroori hai." });
      continue;
    }

    const warning = duplicateNameWarning(input.vendorName, seenNames);
    if (warning) warnings.push({ row: input.row, message: warning });

    const vendor = await insertVendor(orgId, input.vendorName, input, createdBy);
    created.push({ row: input.row, vendor });
    seenNames.push(vendor.Vendor_Name); // so duplicates within the same file are caught too
  }

  return { created, errors, warnings };
}
