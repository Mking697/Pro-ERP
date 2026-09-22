import type { InferSelectModel } from "drizzle-orm";
import { transportVendors } from "@/db/schema";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * Transport Vendor Master — mirrors src/lib/parties/vendors.ts (Purchase Vendor master)
 * almost exactly, kept in its own file under src/lib/tms/ rather than src/lib/parties/
 * since it's specific to TMS's own domain (see src/db/schema/tms.ts's own header comment)
 * rather than the general Purchase/Sales party book.
 */
export interface TransportVendorRecord {
  Vendor_ID: string;
  Vendor_Name: string;
  Contact_Person: string;
  Phone: string;
  Email: string;
  GSTIN: string;
  Address: string;
  City: string;
  State: string;
  Status: string;
  Created_At: string;
  Created_By: string;
}

type TransportVendorRow = InferSelectModel<typeof transportVendors>;

function rowToRecord(row: TransportVendorRow): TransportVendorRecord {
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
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
    Created_By: row.createdBy,
  };
}

export async function listTransportVendors(): Promise<TransportVendorRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(transportVendors, orgId);
  return rows.map(rowToRecord);
}

/** Case/space-insensitive, never blocks — same convention as every other master in this
 * codebase (Purchase Vendor, Customer, Item). */
function duplicateNameWarning(name: string, existingNames: string[]): string | null {
  const normalized = name.trim().toLowerCase();
  return existingNames.some((n) => n.trim().toLowerCase() === normalized)
    ? `"${name.trim()}" naam se ek Transport Vendor pehle se bana hua hai.`
    : null;
}

interface TransportVendorFields {
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
}

async function insertTransportVendor(
  orgId: string,
  vendorName: string,
  fields: TransportVendorFields,
  createdBy: string
): Promise<TransportVendorRecord> {
  const row = await insertRecord(transportVendors, {
    id: generateId("TRV"),
    orgId,
    vendorName: vendorName.trim(),
    contactPerson: fields.contactPerson?.trim() ?? "",
    phone: fields.phone?.trim() ?? "",
    email: fields.email?.trim() ?? "",
    gstin: fields.gstin?.trim() ?? "",
    address: fields.address?.trim() ?? "",
    city: fields.city?.trim() ?? "",
    state: fields.state?.trim() ?? "",
    status: "Active",
    createdBy,
  });
  return rowToRecord(row);
}

export interface CreateTransportVendorInput extends TransportVendorFields {
  vendorName: string;
  createdBy: string;
}

export interface CreateTransportVendorResult {
  vendor: TransportVendorRecord;
  warning: string | null;
}

export async function createTransportVendor(
  input: CreateTransportVendorInput
): Promise<CreateTransportVendorResult> {
  if (!input.vendorName.trim()) {
    throw new Error("Transport Vendor ka naam zaroori hai.");
  }

  const orgId = await getTenantOrgId();
  const existing = await listByOrg(transportVendors, orgId);
  const warning = duplicateNameWarning(input.vendorName, existing.map((v) => v.vendorName));

  const vendor = await insertTransportVendor(orgId, input.vendorName, input, input.createdBy);
  return { vendor, warning };
}

export interface BulkCreateTransportVendorRowInput extends TransportVendorFields {
  /** 1-based row number in the uploaded file (header row is 1), only for error messages. */
  row: number;
  vendorName: string;
}

export interface BulkCreateTransportVendorResult {
  created: { row: number; vendor: TransportVendorRecord }[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

/** Same row-per-row insert shape as createVendorsBulk() — see that function's own comment
 * for why there is no bulk-insert primitive to reach for here yet. */
export async function createTransportVendorsBulk(
  inputs: BulkCreateTransportVendorRowInput[],
  createdBy: string
): Promise<BulkCreateTransportVendorResult> {
  const created: { row: number; vendor: TransportVendorRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];

  const orgId = await getTenantOrgId();
  const seenNames = (await listByOrg(transportVendors, orgId)).map((v) => v.vendorName);

  for (const input of inputs) {
    if (!input.vendorName.trim()) {
      errors.push({ row: input.row, message: "Transport Vendor ka naam zaroori hai." });
      continue;
    }

    const warning = duplicateNameWarning(input.vendorName, seenNames);
    if (warning) warnings.push({ row: input.row, message: warning });

    const vendor = await insertTransportVendor(orgId, input.vendorName, input, createdBy);
    created.push({ row: input.row, vendor });
    seenNames.push(vendor.Vendor_Name);
  }

  return { created, errors, warnings };
}
