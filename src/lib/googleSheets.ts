import { google, sheets_v4 } from "googleapis";
import { getGoogleAuthClient } from "@/lib/googleAuth";

let cachedClient: sheets_v4.Sheets | null = null;

/** Shared authenticated Sheets client. */
export function getSheetsClient(): sheets_v4.Sheets {
  if (!cachedClient) {
    cachedClient = google.sheets({ version: "v4", auth: getGoogleAuthClient() });
  }
  return cachedClient;
}

/**
 * Every tenant's traffic funnels through one service account, so the Sheets API's
 * per-project rate limit is a shared resource: one org's burst can 429 everyone else.
 * Retrying with backoff on 429/5xx turns a hard failure into a slow success, which is
 * the difference between "the app is down" and "that page took two seconds".
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { code?: number; status?: number })?.code
        ?? (error as { status?: number })?.status;
      const retryable = status === 429 || status === 500 || status === 503;
      if (!retryable || attempt === attempts - 1) throw error;

      // 250ms, 500ms, 1s — plus jitter so parallel requests don't retry in lockstep.
      const backoff = 250 * 2 ** attempt + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError;
}

/** Reads every row (including the header row) of a tab in an explicitly named spreadsheet. */
export async function readRows(
  spreadsheetId: string,
  tabName: string
): Promise<string[][]> {
  const sheets = getSheetsClient();
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: tabName })
  );
  return (res.data.values as string[][]) ?? [];
}

/**
 * Reads several tabs of one spreadsheet in a single API call. A dashboard that needs
 * Users + Settings costs one request instead of two — which directly raises how many
 * tenants fit under the shared per-project quota.
 */
export async function readRowsBatch(
  spreadsheetId: string,
  tabNames: string[]
): Promise<Record<string, string[][]>> {
  if (tabNames.length === 0) return {};

  const sheets = getSheetsClient();
  const res = await withRetry(() =>
    sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabNames })
  );

  const out: Record<string, string[][]> = {};
  (res.data.valueRanges ?? []).forEach((range, i) => {
    out[tabNames[i]] = (range.values as string[][]) ?? [];
  });
  return out;
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

/** Appends one row to the end of a tab. */
export async function appendRow(
  spreadsheetId: string,
  tabName: string,
  row: (string | number)[]
): Promise<void> {
  const sheets = getSheetsClient();
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      // RAW, not USER_ENTERED: the sheet is this app's database, so a value must
      // come back exactly as it was written. USER_ENTERED lets Sheets reinterpret
      // input — a "+919876543210" phone number is parsed as a formula and stored as
      // 919876543210, silently breaking the WhatsApp number it is sent to.
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    })
  );
}

/**
 * Appends many rows in one call.
 *
 * A BOM with twenty lines would otherwise cost twenty requests against a quota every
 * tenant shares — a limit this project has already hit in practice.
 */
export async function appendRows(
  spreadsheetId: string,
  tabName: string,
  rows: (string | number)[][]
): Promise<void> {
  if (rows.length === 0) return;

  const sheets = getSheetsClient();
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows },
    })
  );
}

/** Overwrites a single row (1-indexed, including header) in a tab. */
export async function updateRow(
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
  row: (string | number)[]
): Promise<void> {
  const sheets = getSheetsClient();
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    })
  );
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

export interface CellUpdate {
  /** 1-indexed, including the header row. */
  rowNumber: number;
  /** 0-indexed column position. */
  columnIndex: number;
  value: string | number;
}

/**
 * Writes many individual cells in one API call.
 *
 * Two reasons this exists rather than looping `updateRow`. Editing a hundred items would
 * otherwise cost a hundred requests against a per-project quota every tenant shares. And
 * writing only the cells that changed leaves the rest of each row untouched, so a bulk
 * edit of planning fields cannot overwrite a name or category someone changed meanwhile.
 */
export async function updateCells(
  spreadsheetId: string,
  tabName: string,
  updates: CellUpdate[]
): Promise<void> {
  if (updates.length === 0) return;

  const sheets = getSheetsClient();
  await withRetry(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.map((u) => ({
          range: `${tabName}!${columnLetter(u.columnIndex)}${u.rowNumber}`,
          values: [[u.value]],
        })),
      },
    })
  );
}

/**
 * Removes one row from a tab, closing the gap behind it.
 *
 * Deleting a dimension needs the tab's numeric id, not its name, so the tab is looked up
 * first. Every row below the deleted one shifts up by one — which is why callers must
 * resolve the row number and delete in the same breath, never hold one across a write.
 */
export async function deleteRow(
  spreadsheetId: string,
  tabName: string,
  rowNumber: number
): Promise<void> {
  const sheets = getSheetsClient();

  const meta = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" })
  );
  const tab = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  const sheetId = tab?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Tab "${tabName}" nahi mila.`);
  }

  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                // The API counts from 0 and excludes the end, where a sheet row number
                // counts from 1 — so row 5 is the half-open range [4, 5).
                startIndex: rowNumber - 1,
                endIndex: rowNumber,
              },
            },
          },
        ],
      },
    })
  );
}

/** Verifies the service account can actually reach a spreadsheet. */
export async function verifySheetAccess(spreadsheetId: string): Promise<boolean> {
  try {
    const sheets = getSheetsClient();
    await withRetry(() => sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" }));
    return true;
  } catch {
    return false;
  }
}
