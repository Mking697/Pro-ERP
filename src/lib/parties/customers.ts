import { appendModuleRow, appendModuleRows, getModuleRows, recordToRow } from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { nowStamp } from "@/lib/timestamp";

const MODULE_KEY = "CUSTOMERS";

/** One row of the customer master. Only Customer_Name is ever required — everything else
 * is optional contact/billing detail a Sales Order can fill in over time. */
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

export async function listCustomers(): Promise<CustomerRecord[]> {
  return getModuleRows<CustomerRecord>(MODULE_KEY);
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

function buildRecord(
  customerName: string,
  fields: CustomerFields,
  createdBy: string
): CustomerRecord {
  return {
    Customer_ID: generateId("CUS"),
    Customer_Name: customerName.trim(),
    Contact_Person: fields.contactPerson?.trim() ?? "",
    Phone: fields.phone?.trim() ?? "",
    Email: fields.email?.trim() ?? "",
    GSTIN: fields.gstin?.trim() ?? "",
    Billing_Address: fields.billingAddress?.trim() ?? "",
    Shipping_Address: fields.shippingAddress?.trim() ?? "",
    City: fields.city?.trim() ?? "",
    State: fields.state?.trim() ?? "",
    Credit_Terms: fields.creditTerms?.trim() ?? "",
    Status: "Active",
    Created_At: nowStamp(),
    Created_By: createdBy,
  };
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

  const existing = await listCustomers();
  const warning = duplicateNameWarning(input.customerName, existing.map((c) => c.Customer_Name));

  const record = buildRecord(input.customerName, input, input.createdBy);
  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return { customer: record, warning };
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
 * Creates many customers from one uploaded spreadsheet in a single Sheets write — same
 * shape as createVendorsBulk()/createItemsBulk(): Customer_ID is a generated key nobody
 * types, so there is nothing to collide on across rows.
 */
export async function createCustomersBulk(
  inputs: BulkCreateCustomerRowInput[],
  createdBy: string
): Promise<BulkCreateCustomerResult> {
  const created: { row: number; customer: CustomerRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];
  const rows: (string | number)[][] = [];

  const seenNames = (await listCustomers()).map((c) => c.Customer_Name);

  for (const input of inputs) {
    if (!input.customerName.trim()) {
      errors.push({ row: input.row, message: "Customer ka naam zaroori hai." });
      continue;
    }

    const warning = duplicateNameWarning(input.customerName, seenNames);
    if (warning) warnings.push({ row: input.row, message: warning });

    const record = buildRecord(input.customerName, input, createdBy);
    created.push({ row: input.row, customer: record });
    rows.push(recordToRow(MODULE_KEY, record));
    seenNames.push(record.Customer_Name); // so duplicates within the same file are caught too
  }

  if (rows.length > 0) {
    await appendModuleRows(MODULE_KEY, rows);
  }

  return { created, errors, warnings };
}
