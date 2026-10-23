import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth/live-session";
import {
  canSeeReport,
  getReport,
  resolveReportScope,
  type ReportViewer,
} from "@/lib/reports";
import { resolveRange } from "@/lib/analytics";
import { fetchReportTable } from "@/lib/reportExport";
import { buildCsv, csvResponseHeaders, xlsxSafeText } from "@/lib/csv";

/**
 * One generic export endpoint for every report in the registry (`performance` excepted —
 * it keeps its own richer `/api/analytics/export`). Applies the exact same auth/grant,
 * date-range and mine/all-scope resolution as `reports/[report]/page.tsx` itself, so an
 * export can never show rows the screen wouldn't — same filters on screen and download,
 * per this project's own report-redesign convention.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> }
) {
  const session = await getLiveSession();
  if (!session) return NextResponse.json({ error: "Login required." }, { status: 401 });

  const { report: reportId } = await params;
  const definition = getReport(reportId);
  // Unknown id and no-grant both 404, mirroring the screen's own "don't leak which
  // reports exist" behaviour.
  if (!definition || !canSeeReport(definition, session.access)) {
    return NextResponse.json({ error: "Report nahi mila." }, { status: 404 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const range = resolveRange(
    url.searchParams.get("range") ?? "month",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined
  );
  const viewer: ReportViewer = {
    userId: session.userId,
    email: session.email,
    role: session.role,
    access: session.access,
  };
  const scope = definition.personal
    ? "mine"
    : resolveReportScope(url.searchParams.get("scope"), viewer);

  const table = await fetchReportTable(reportId, range, scope, viewer);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${reportId}-${range.key}-${stamp}.${format}`;

  if (format === "csv") {
    const csv = buildCsv([table.header, ...table.rows.map((row) => table.keys.map((k) => row[k]))]);
    return new NextResponse(csv, { headers: csvResponseHeaders(filename) });
  }

  const book = new ExcelJS.Workbook();
  const page = book.addWorksheet(definition.label.slice(0, 31) || "Report");
  page.addRow(table.header);
  for (const row of table.rows) {
    page.addRow(table.keys.map((k) => (typeof row[k] === "number" ? row[k] : xlsxSafeText(row[k]))));
  }
  page.views = [{ state: "frozen", ySplit: 1 }];
  page.columns.forEach((column) => { column.width = 22; });
  const buffer = await book.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
