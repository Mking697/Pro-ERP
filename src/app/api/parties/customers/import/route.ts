import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { parseImportFile } from "@/lib/importFile";
import { createCustomersBulk, type BulkCreateCustomerRowInput } from "@/lib/parties/customers";

// Same ceiling as the item import — Vercel's Hobby serverless functions cap a request
// body around 4.5MB, and a spreadsheet of customer rows is plain text/XML and tiny per row.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// A single import writing thousands of rows in one Sheets call risks the serverless
// function's own time limit long before it risks the Sheets API's.
const MAX_ROWS = 2000;

const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type CustomerField = keyof Omit<BulkCreateCustomerRowInput, "row">;

const HEADER_ALIASES: Record<string, CustomerField> = {
  customername: "customerName",
  name: "customerName",
  contactperson: "contactPerson",
  contact: "contactPerson",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  email: "email",
  gstin: "gstin",
  gst: "gstin",
  billingaddress: "billingAddress",
  address: "billingAddress",
  shippingaddress: "shippingAddress",
  city: "city",
  state: "state",
  creditterms: "creditTerms",
};

export async function POST(request: Request) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Koi file nahi mili." }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File ${MAX_FILE_BYTES / (1024 * 1024)}MB se chhoti honi chahiye.` },
      { status: 400 }
    );
  }

  if (!hasAllowedExtension(file.name)) {
    return NextResponse.json(
      { error: "Sirf .csv, .xlsx ya .xls file upload karein." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = await parseImportFile<CustomerField, BulkCreateCustomerRowInput>(
      buffer,
      file.name,
      file.type,
      HEADER_ALIASES,
      "customerName",
      (row, fields) => ({
        row,
        customerName: fields.customerName ?? "",
        contactPerson: fields.contactPerson ?? "",
        phone: fields.phone ?? "",
        email: fields.email ?? "",
        gstin: fields.gstin ?? "",
        billingAddress: fields.billingAddress ?? "",
        shippingAddress: fields.shippingAddress ?? "",
        city: fields.city ?? "",
        state: fields.state ?? "",
        creditTerms: fields.creditTerms ?? "",
      })
    );
  } catch {
    return NextResponse.json(
      { error: "File padhi nahi ja saki — sahi template download karke dobara try karein." },
      { status: 400 }
    );
  }

  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return NextResponse.json({ error: "File me koi row nahi mili." }, { status: 400 });
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Ek baar me zyada se zyada ${MAX_ROWS} rows import ki ja sakti hain.` },
      { status: 400 }
    );
  }

  const result = await createCustomersBulk(parsed.rows, guard.session.email);

  return NextResponse.json({
    created: result.created.length,
    errors: result.errors,
    warnings: result.warnings,
  });
}
