import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/**
 * The blank spreadsheet a bulk vendor import starts from — same column labels as the New
 * Vendor dialog, so filling this in feels like the same form, just wider. Header text is
 * matched loosely on import (see src/lib/importFile.ts), so renaming or reordering these
 * columns still works; this is only the friendliest starting point, not the only accepted
 * shape.
 */
export async function GET() {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const csv = buildCsv([
    [
      "Vendor Name",
      "Contact Person",
      "Phone",
      "Email",
      "GSTIN",
      "Address",
      "City",
      "State",
      "Payment Terms",
      "Bank Name",
      "Bank Account No",
      "IFSC",
    ],
    // One example row shows the expected shape. Its name says to remove it outright, so
    // a person who forgets ends up with an obviously-named junk row, not a silent one.
    [
      "EXAMPLE - delete this row before uploading",
      "Rajesh Kumar",
      "9876543210",
      "vendor@example.com",
      "22AAAAA0000A1Z5",
      "Plot 12, Industrial Area",
      "Ludhiana",
      "Punjab",
      "Net 30",
      "State Bank of India",
      "000000000000",
      "SBIN0000000",
    ],
  ]);

  return new NextResponse(csv, {
    headers: csvResponseHeaders("vendors-import-template.csv"),
  });
}
