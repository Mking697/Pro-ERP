import { readRows, readRowsBatch, appendRow, updateRow } from "@/lib/googleSheets";
import { getTenantSheetId } from "@/lib/tenant";

/**
 * Tenant-scoped access to the current organization's System spreadsheet (Users + Settings).
 *
 * These wrap the raw primitives in `googleSheets.ts`, which always demand an explicit
 * spreadsheet ID. The split is the point: raw calls can never accidentally read "the
 * default sheet", and anything that omits an ID here resolves through `getTenant()`,
 * which throws rather than guessing.
 */

export async function getSheetRows(
  tabName: string,
  spreadsheetId?: string
): Promise<string[][]> {
  return readRows(spreadsheetId ?? (await getTenantSheetId()), tabName);
}

/** Reads several tabs of the tenant's System sheet in a single API call. */
export async function getSheetRowsBatch(
  tabNames: string[],
  spreadsheetId?: string
): Promise<Record<string, string[][]>> {
  return readRowsBatch(spreadsheetId ?? (await getTenantSheetId()), tabNames);
}

export async function appendSheetRow(
  tabName: string,
  row: (string | number)[],
  spreadsheetId?: string
): Promise<void> {
  return appendRow(spreadsheetId ?? (await getTenantSheetId()), tabName, row);
}

export async function updateSheetRow(
  tabName: string,
  rowNumber: number,
  row: (string | number)[],
  spreadsheetId?: string
): Promise<void> {
  return updateRow(spreadsheetId ?? (await getTenantSheetId()), tabName, rowNumber, row);
}

export { rowsToObjects, getSheetsClient, verifySheetAccess } from "@/lib/googleSheets";
