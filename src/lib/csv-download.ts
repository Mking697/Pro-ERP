"use client";

import { buildCsv } from "@/lib/csv";

/**
 * Builds a CSV in the browser and triggers a save-as-file download — the client-side
 * counterpart to csvResponseHeaders() (src/lib/csv.ts) for exports whose row data is
 * already loaded in a table's own state, so no round trip to the server is needed just
 * to turn what's already on screen into a file (e.g. "Export selected to CSV" on a
 * bulk-selection toolbar). Reuses buildCsv()'s own formula-injection defusing and
 * Excel-friendly BOM/CRLF — one escaping implementation, not a second one re-derived here.
 */
export function downloadCsvClientSide(filename: string, rows: (string | number)[][]): void {
  const csv = buildCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
