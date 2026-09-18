import type { InferSelectModel } from "drizzle-orm";
import { customers } from "@/db/schema";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `customers` Postgres table —
 * the goal is zero changes at the API routes and the `/parties` frontend, which both read
 * `.Customer_Name`, `.Contact_Person`, etc. off this type today.
 */
export interface CustomerRecord {
  Customer_ID: string;
  Customer_Name: string;
  Contact_Person: string;
  Phone: string;
  Email: string;
  GSTIN: string;
  Billing_Address: string;
  Shipping_Address: string;
  City: string;
  State: string;
  Credit_Terms: string;
  Status: string;
  Created_At: string;
  Created_By: string;
}

type CustomerRow = InferSelectModel<typeof customers>;

function rowToRecord(row: CustomerRow): CustomerRecord {
  return {
    Customer_ID: row.id,
    Customer_Name: row.customerName,
    Contact_Person: row.contactPerson,
    Phone: row.phone,
    Email: row.email,
    GSTIN: row.gstin,
    Billing_Address: row.billingAddress,
    Shipping_Address: row.shippingAddress,
    City: row.city,
    State: row.state,
    Credit_Terms: row.creditTerms,
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
    Created_By: row.createdBy,
  };
}

export async function listCustomers(): Promise<CustomerRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(customers, orgId);
  return rows.map(rowToRecord);
}

/** Customer_ID is generated, so there's nothing to collide on — but two rows named the
 * same is still worth a heads-up (easy to create by accident, e.g. re-adding a customer
 * who's already there). Case/space-insensitive so "ABC Traders" and "abc traders " still
 * match. Never blocks the save, only flags it. */
function duplicateNameWarning(name: string, existingNames: string[]): string | null {
  const normalized = name.trim().toLowerCase();
  return existingNames.some((n) => n.trim().toLowerCase() === normalized)
    ? `"${name.trim()}" naam se ek Customer pehle se bana hua hai.`
    : null;
}

/** The optional fields shared by a single manual add and one row of a bulk import. */
interface CustomerFields {
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  billingAddress?: string;
  shippingAddress?: string;
  city?: string;
  state?: string;
  creditTerms?: string;
}

async function insertCustomer(
  orgId: string,
  customerName: string,
  fields: CustomerFields,
  createdBy: string
): Promise<CustomerRecord> {
  const row = await insertRecord(customers, {
    id: generateId("CUS"),
    orgId,
    customerName: customerName.trim(),
    contactPerson: fields.contactPerson?.trim() ?? "",
    phone: fields.phone?.trim() ?? "",
    email: fields.email?.trim() ?? "",
    gstin: fields.gstin?.trim() ?? "",
    billingAddress: fields.billingAddress?.trim() ?? "",
    shippingAddress: fields.shippingAddress?.trim() ?? "",
    city: fields.city?.trim() ?? "",
    state: fields.state?.trim() ?? "",
    creditTerms: fields.creditTerms?.trim() ?? "",
    status: "Active",
    createdBy,
  });
  return rowToRecord(row);
}

export interface CreateCustomerInput extends CustomerFields {
  customerName: string;
  createdBy: string;
}

export interface CreateCustomerResult {
  customer: CustomerRecord;
  warning: string | null;
}

export async function createCustomer(input: CreateCustomerInput): Promise<CreateCustomerResult> {
  if (!input.customerName.trim()) {
    throw new Error("Customer ka naam zaroori hai.");
  }

  const orgId = await getTenantOrgId();
  const existing = await listByOrg(customers, orgId);
  const warning = duplicateNameWarning(input.customerName, existing.map((c) => c.customerName));

  const customer = await insertCustomer(orgId, input.customerName, input, input.createdBy);
  return { customer, warning };
}

export interface BulkCreateCustomerRowInput extends CustomerFields {
  /** 1-based row number in the uploaded file (header row is 1), only for error messages. */
  row: number;
  customerName: string;
}

export interface BulkCreateCustomerResult {
  created: { row: number; customer: CustomerRecord }[];
  errors: { row: number; message: string }[];
  /** Rows created despite matching a name already in the sheet, or repeated within the
   * same file — still created, just flagged, same as the manual-add dialog's warning. */
  warnings: { row: number; message: string }[];
}

/**
 * Creates many customers from one uploaded spreadsheet — same shape as
 * createVendorsBulk()/createItemsBulk(): Customer_ID is a generated key nobody types, so
 * there is nothing to collide on across rows. Each row is its own insert (no bulk-insert
 * primitive in repo.ts yet), but that is still one row-per-row round trip to Postgres
 * rather than a full-sheet rewrite, so there is no equivalent of the old single-Sheets-call
 * batching to preserve.
 */
export async function createCustomersBulk(
  inputs: BulkCreateCustomerRowInput[],
  createdBy: string
): Promise<BulkCreateCustomerResult> {
  const created: { row: number; customer: CustomerRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];

  const orgId = await getTenantOrgId();
  const seenNames = (await listByOrg(customers, orgId)).map((c) => c.customerName);

  for (const input of inputs) {
    if (!input.customerName.trim()) {
      errors.push({ row: input.row, message: "Customer ka naam zaroori hai." });
      continue;
    }

    const warning = duplicateNameWarning(input.customerName, seenNames);
    if (warning) warnings.push({ row: input.row, message: warning });

    const customer = await insertCustomer(orgId, input.customerName, input, createdBy);
    created.push({ row: input.row, customer });
    seenNames.push(customer.Customer_Name); // so duplicates within the same file are caught too
  }

  return { created, errors, warnings };
}
