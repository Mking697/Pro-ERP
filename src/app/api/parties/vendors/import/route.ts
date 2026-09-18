import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { parseImportFile } from "@/lib/importFile";
import { createVendorsBulk, type BulkCreateVendorRowInput } from "@/lib/parties/vendors";

// Same ceiling as the item import — Vercel's Hobby serverless functions cap a request
// body around 4.5MB, and a spreadsheet of vendor rows is plain text/XML and tiny per row.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

// createVendorsBulk() writes one row at a time (no bulk-insert primitive for it yet), so
// thousands of rows risk the serverless function's own time limit well before anything else.
const MAX_ROWS = 2000;

const ALLOWED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

type VendorField = keyof Omit<BulkCreateVendorRowInput, "row">;

const HEADER_ALIASES: Record<string, VendorField> = {
  vendorname: "vendorName",
  name: "vendorName",
  contactperson: "contactPerson",
  contact: "contactPerson",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  email: "email",
  gstin: "gstin",
  gst: "gstin",
  address: "address",
  city: "city",
  state: "state",
  paymentterms: "paymentTerms",
  bankname: "bankName",
  bankaccountno: "bankAccountNo",
  bankaccountnumber: "bankAccountNo",
  accountno: "bankAccountNo",
  ifsc: "ifsc",
  ifsccode: "ifsc",
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
    parsed = await parseImportFile<VendorField, BulkCreateVendorRowInput>(
      buffer,
      file.name,
      file.type,
      HEADER_ALIASES,
      "vendorName",
      (row, fields) => ({
        row,
        vendorName: fields.vendorName ?? "",
        contactPerson: fields.contactPerson ?? "",
        phone: fields.phone ?? "",
        email: fields.email ?? "",
        gstin: fields.gstin ?? "",
        address: fields.address ?? "",
        city: fields.city ?? "",
        state: fields.state ?? "",
        paymentTerms: fields.paymentTerms ?? "",
        bankName: fields.bankName ?? "",
        bankAccountNo: fields.bankAccountNo ?? "",
        ifsc: fields.ifsc ?? "",
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

  const result = await createVendorsBulk(parsed.rows, guard.session.email);

  return NextResponse.json({
    created: result.created.length,
    errors: result.errors,
    warnings: result.warnings,
  });
}
