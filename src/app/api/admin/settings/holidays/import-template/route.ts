import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/** The blank spreadsheet a bulk holiday import starts from. Header text is matched
 * loosely on import (see src/lib/importFile.ts), so renaming/reordering still works. */
export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const csv = buildCsv([
    ["Date", "Name"],
    // One example row shows the expected shape. Its name says to remove it outright, so
    // a person who forgets ends up with an obviously-named junk row, not a silent one.
    ["EXAMPLE - delete this row before uploading", "Diwali"],
    ["2026-10-20", "Diwali"],
  ]);

  return new NextResponse(csv, {
    headers: csvResponseHeaders("holidays-import-template.csv"),
  });
}
