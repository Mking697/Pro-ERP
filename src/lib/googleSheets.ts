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
