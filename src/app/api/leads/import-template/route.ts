import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/**
 * The blank spreadsheet a bulk lead import starts from — same column labels as the New
 * Lead dialog, mirroring src/app/api/parties/vendors/import-template/route.ts. Header text
 * is matched loosely on import (src/lib/importFile.ts), so renaming/reordering these
 * columns still works.
 */
export async function GET() {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const csv = buildCsv([
    ["Person Name", "Phone", "Email", "Company Name", "City", "State", "Product Interest", "Message"],
    [
      "EXAMPLE - delete this row before uploading",
      "9876543210",
      "lead@example.com",
      "ABC Traders",
      "Ludhiana",
      "Punjab",
      "Wall Panels",
      "Enquired at exhibition",
    ],
  ]);

  return new NextResponse(csv, {
    headers: csvResponseHeaders("leads-import-template.csv"),
  });
}
