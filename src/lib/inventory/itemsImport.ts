import ExcelJS from "exceljs";
import { parseCsv } from "@/lib/csv";
import type { BulkCreateRowInput } from "@/lib/inventory/items";

/**
 * Turns an uploaded spreadsheet (the downloaded template, filled in) into the same
 * per-row input createItem() already validates one at a time. Column headers are matched
 * loosely — case, spacing and underscores are all ignored — so both the friendly labels
 * the template ships with ("Item Name") and the sheet's own internal header names
 * ("Item_Name") work, and a person who reorders or slightly retypes a header doesn't get
 * a cryptic "column not found".
 */
const HEADER_ALIASES: Record<string, keyof BulkCreateRowInput> = {
  itemname: "itemName",
  name: "itemName",
  sku: "sku",
  category: "category",
  uom: "uom",
  unit: "uom",
  sizeunit: "sizeUnit",
  size: "sizeUnit",
  rate: "rate",
  leadtimedays: "leadTimeDays",
  leadtime: "leadTimeDays",
  safetyfactor: "safetyFactor",
  moq: "moq",
  maxlevel: "maxLevel",
  location: "location",
  openingstock: "openingStock",
  availablestock: "openingStock",
  currentstock: "openingStock",
  stock: "openingStock",
};

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

function toNumberOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export interface ParsedItemsFile {
  rows: BulkCreateRowInput[];
  /** Set when the file could not be read at all — no known column was recognized, or the
   * file is empty. Individual bad rows are reported later, by createItemsBulk. */
  error?: string;
}

/**
 * Reads either a .csv or a .xlsx/.xls upload into rows ready for createItemsBulk().
 * Detected by MIME type first (what the browser sends), falling back to the filename
 * extension for the odd browser/OS combination that sends a generic octet-stream type.
 */
export async function parseItemsFile(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<ParsedItemsFile> {
  const looksLikeCsv =
    mimeType.includes("csv") || (!mimeType.includes("sheet") && /\.csv$/i.test(filename));

  const grid = looksLikeCsv
    ? parseCsv(buffer.toString("utf8"))
    : await gridFromXlsx(buffer);

  if (grid.length === 0) {
    return { rows: [], error: "File khaali hai." };
  }

  const [headerRow, ...dataRows] = grid;
  const columns = headerRow.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);

  if (!columns.includes("itemName")) {
    return {
      rows: [],
      error:
        "File ke headers pehchane nahi gaye — 'Item Name' column nahi mila. Template download karke usi format me data bharein.",
    };
  }

  const rows: BulkCreateRowInput[] = [];
  dataRows.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === "")) return; // a blank trailing row

    const byField: Partial<Record<keyof BulkCreateRowInput, string>> = {};
    columns.forEach((field, colIndex) => {
      if (field) byField[field] = cells[colIndex] ?? "";
    });

    rows.push({
      row: i + 2, // 1-based, plus the header row
      sku: byField.sku?.trim() || undefined,
      itemName: byField.itemName?.trim() ?? "",
      category: byField.category?.trim() ?? "",
      uom: byField.uom?.trim() ?? "",
      sizeUnit: byField.sizeUnit?.trim() ?? "",
      location: byField.location?.trim() ?? "",
      rate: toNumberOrNull(byField.rate),
      leadTimeDays: toNumberOrNull(byField.leadTimeDays),
      safetyFactor: toNumberOrNull(byField.safetyFactor),
      moq: toNumberOrNull(byField.moq),
      maxLevel: toNumberOrNull(byField.maxLevel),
      openingStock: toNumberOrNull(byField.openingStock),
    });
  });

  return { rows };
}
