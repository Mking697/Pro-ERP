import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/**
 * The blank spreadsheet a bulk customer import starts from — same column labels as the
 * New Customer dialog. Header text is matched loosely on import (see
 * src/lib/importFile.ts), so renaming or reordering these columns still works; this is
 * only the friendliest starting point, not the only accepted shape.
 */
export async function GET() {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const csv = buildCsv([
    [
      "Customer Name",
      "Contact Person",
      "Phone",
      "Email",
      "GSTIN",
      "Billing Address",
      "Shipping Address",
      "City",
      "State",
      "Credit Terms",
    ],
    // One example row shows the expected shape. Its name says to remove it outright, so
    // a person who forgets ends up with an obviously-named junk row, not a silent one.
    [
      "EXAMPLE - delete this row before uploading",
      "Priya Sharma",
      "9876500000",
      "customer@example.com",
      "22BBBBB0000B1Z5",
      "45 MG Road",
      "45 MG Road",
      "Pune",
      "Maharashtra",
      "Net 15",
    ],
  ]);

  return new NextResponse(csv, {
    headers: csvResponseHeaders("customers-import-template.csv"),
  });
}
