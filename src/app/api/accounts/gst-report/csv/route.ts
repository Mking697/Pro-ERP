import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getGstReturnSummary } from "@/lib/accounts/accounts";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/** GSTR-1-shaped line-item export — the practical thing an org's accountant actually needs
 * (most GST filing software/portals accept CSV/Excel import). Not e-filing itself. */
export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const summary = await getGstReturnSummary({ from, to });

  const rows: (string | number)[][] = [
    ["Invoice No", "Invoice Date", "Customer Name", "Customer GSTIN", "Taxable Value", "GST Amount", "Invoice Value"],
    ...summary.lines.map((line) => [
      line.invoiceNo,
      line.invoiceDate.slice(0, 10),
      line.customerName,
      line.customerGstin,
      line.taxableValue,
      line.gstAmount,
      line.invoiceValue,
    ]),
    ["", "", "", "Total", summary.totalTaxableValue, summary.totalGst, summary.totalInvoiceValue],
  ];

  const csv = buildCsv(rows);
  const filename = `GST_Report_${from ?? "all"}_to_${to ?? "all"}.csv`;
  return new NextResponse(csv, { headers: csvResponseHeaders(filename) });
}
