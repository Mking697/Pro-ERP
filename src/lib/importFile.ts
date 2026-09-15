import ExcelJS from "exceljs";
import { parseCsv } from "@/lib/csv";

/**
 * Generic loose-header-matching parser for an uploaded .csv/.xlsx/.xls file, shared by
 * every bulk importer that follows the Items pattern (download a template, fill it in
 * Excel, upload it back). `src/lib/inventory/itemsImport.ts` predates this file and has
 * its own working copy of the same logic — left alone rather than risked, since Items'
 * import path is already relied on. Everything built after Items (Vendors, Customers, and
 * whatever comes next) should call this instead of growing a fourth copy.
 *
 * Column headers are matched loosely — case, spacing and underscores are all ignored — so
 * both a friendly template label ("Vendor Name") and the sheet's own internal header
 * ("Vendor_Name") work, the same reasoning as itemsImport.ts.
 */

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return "";
  }
  return String(value);
}

async function gridFromXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]; // 1-indexed; values[0] is unused
    const cells: string[] = [];
    for (let i = 1; i < values.length; i++) cells.push(cellToText(values[i]));
    rows.push(cells);
  });
  return rows;
}

export interface ParsedImportFile<T> {
  rows: T[];
  /** Set when the file could not be read at all — no known column was recognized, or the
   * file is empty. Individual bad rows are reported later, by the caller's own bulk-create
   * function (e.g. createVendorsBulk), the same split itemsImport.ts uses. */
  error?: string;
}

/**
 * Reads either a .csv or a .xlsx/.xls upload into rows of the caller's own shape.
 *
 * - `aliases` maps a normalized header (see `normalizeHeader`) to one of the caller's
 *   field keys `F`.
 * - `requiredField` is the one field whose absence in the recognized columns means the
 *   header row wasn't understood at all (e.g. no "Vendor Name" column found).
 * - `build` turns one data row's recognized, trimmed cell values into the caller's row
 *   type `T`, given that row's 1-based position in the uploaded file (header row is 1).
 *
 * Detected as CSV vs. XLSX by MIME type first (what the browser sends), falling back to
 * the filename extension for the odd browser/OS combination that sends a generic
 * octet-stream type — same detection itemsImport.ts uses.
 */
export async function parseImportFile<F extends string, T>(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  aliases: Record<string, F>,
  requiredField: F,
  build: (row: number, fields: Partial<Record<F, string>>) => T
): Promise<ParsedImportFile<T>> {
  const looksLikeCsv =
    mimeType.includes("csv") || (!mimeType.includes("sheet") && /\.csv$/i.test(filename));

  const grid = looksLikeCsv
    ? parseCsv(buffer.toString("utf8"))
    : await gridFromXlsx(buffer);

  if (grid.length === 0) {
    return { rows: [], error: "File khaali hai." };
  }

  const [headerRow, ...dataRows] = grid;
  const columns = headerRow.map((h) => aliases[normalizeHeader(h)] ?? null);

  if (!columns.includes(requiredField)) {
    return {
      rows: [],
      error:
        "File ke headers pehchane nahi gaye. Template download karke usi format me data bharein.",
    };
  }

  const rows: T[] = [];
  dataRows.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === "")) return; // a blank trailing row

    const byField: Partial<Record<F, string>> = {};
    columns.forEach((field, colIndex) => {
      if (field) byField[field] = (cells[colIndex] ?? "").trim();
    });

    rows.push(build(i + 2, byField)); // 1-based, plus the header row
  });

  return { rows };
}
