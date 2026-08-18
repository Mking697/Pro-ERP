import { google, sheets_v4 } from "googleapis";
import { getGoogleAuthClient } from "@/lib/googleAuth";

let cachedClient: sheets_v4.Sheets | null = null;

/** Shared authenticated Sheets client — reused by the module-sheet resolver too. */
export function getSheetsClient(): sheets_v4.Sheets {
  if (!cachedClient) {
    cachedClient = google.sheets({ version: "v4", auth: getGoogleAuthClient() });
  }
  return cachedClient;
}

/** The one fixed "System" spreadsheet: holds the Users and Settings tabs. */
export function getRootSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("Missing GOOGLE_SHEET_ID environment variable.");
  }
  return id;
}

/** Reads every row (including the header row) of a tab. Defaults to the root System sheet. */
export async function getSheetRows(
  tabName: string,
  spreadsheetId?: string
): Promise<string[][]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId ?? getRootSpreadsheetId(),
    range: tabName,
  });
  return (res.data.values as string[][]) ?? [];
}

/** Converts [header, ...rows] into an array of objects keyed by header name. */
export function rowsToObjects<T = Record<string, string>>(rows: string[][]): T[] {
  if (rows.length === 0) return [];
  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj as T;
  });
}

/** Appends one row to the end of a tab. Defaults to the root System sheet. */
export async function appendSheetRow(
  tabName: string,
  row: (string | number)[],
  spreadsheetId?: string
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId ?? getRootSpreadsheetId(),
    range: tabName,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

/** Overwrites a single row (1-indexed, including header) in a tab. Defaults to the root System sheet. */
export async function updateSheetRow(
  tabName: string,
  rowNumber: number,
  row: (string | number)[],
  spreadsheetId?: string
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: spreadsheetId ?? getRootSpreadsheetId(),
    range: `${tabName}!A${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}
