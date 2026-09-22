import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/** Same shape as src/app/api/parties/vendors/import-template/route.ts, minus the
 * Purchase-Vendor-only Payment Terms/Bank fields transportVendors doesn't have. */
export async function GET() {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const csv = buildCsv([
    ["Vendor Name", "Contact Person", "Phone", "Email", "GSTIN", "Address", "City", "State"],
    [
      "EXAMPLE - delete this row before uploading",
      "Suresh Transport",
      "9876543210",
      "transport@example.com",
      "22AAAAA0000A1Z5",
      "Plot 5, Transport Nagar",
      "Ludhiana",
      "Punjab",
    ],
  ]);

  return new NextResponse(csv, {
    headers: csvResponseHeaders("transport-vendors-import-template.csv"),
  });
}
