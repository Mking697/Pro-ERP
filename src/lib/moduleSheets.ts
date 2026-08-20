import {
  getSheetsClient,
  getSheetRows,
  appendSheetRow,
  updateSheetRow,
  rowsToObjects,
} from "@/lib/tenantSheets";
import { getSetting } from "@/lib/settings";
import { extractSpreadsheetId, extractGid } from "@/lib/sheetUrl";
import { tenantCached, invalidateTenantCache } from "@/lib/cache";
import { getTenantOrgId } from "@/lib/tenant";

export interface ModuleDefinition {
  key: string;
  label: string;
  settingKey: string;
  headers: string[];
}

/**
 * The business-flow sheets an Admin connects from Settings by pasting a URL —
 * each lives in its own Google Spreadsheet, separate from the root System sheet
 * (which only ever holds Users + Settings, so login keeps working no matter what
 * is configured here).
 */
export const MODULE_SHEETS: ModuleDefinition[] = [
  {
    key: "TASKS",
    label: "Tasks",
    settingKey: "SHEET_URL_TASKS",
    headers: [
      "Task_ID",
      "Title",
      "Description",
      "Assigned_To",
      "Assigned_By",
      "Task_Type",
      "Recurrence_Frequency",
      "Due_Date",
      "Attachment_URL",
      "Status",
      "Completed_At",
      "Completion_Proof_URL",
      "Remark",
      "Created_At",
      "On_Time_Count",
      "Delay_Count",
      "Priority",
      "Recurring_ID",
    ],
  },
  {
    key: "RECURRING_TASKS",
    label: "Recurring Tasks (definitions)",
    settingKey: "SHEET_URL_RECURRING_TASKS",
    headers: [
      "Recurring_ID",
      "Task",
      "Doer_ID",
      "Assigned_By",
      "Frequency",
      "Assign_Date",
      "Status",
      "Created_At",
    ],
  },
  {
    key: "HOLIDAY_LIST",
    label: "Holiday List",
    settingKey: "SHEET_URL_HOLIDAY_LIST",
    headers: ["Date"],
  },
  {
    key: "INWARD_IQC_FMS",
    label: "Inward & IQC FMS",
    settingKey: "SHEET_URL_INWARD_IQC_FMS",
    headers: [
      "Entry_ID",
      "Timestamp",
      "Party_Name",
      "Invoice_No",
      "Inward_Type",
      "Attachment_URL",
      "Remark",
      "IQC_Status",
      "Verified_By",
      "Verified_At",
      "Verify_Checkbox",
      "IQC_Pass_Qty",
      "IQC_Fail_Qty",
      "Fail_Reason",
      "SKU",
      "Item_Name",
    ],
  },
  {
    key: "FAILURE_LOG",
    label: "Failure Log",
    settingKey: "SHEET_URL_FAILURE_LOG",
    headers: [
      "Log_ID",
      "Linked_Entry_ID",
      "Timestamp",
      "Party_Name",
      "Invoice_No",
      "Inward_Type",
      "Fail_Qty",
      "Fail_Reason",
      "Attachment_URL",
      "Verified_By",
    ],
  },
  {
    key: "IMS_INWARD",
    label: "IMS - Inward Sub-Sheet",
    settingKey: "SHEET_URL_IMS_INWARD",
    headers: [
      "Record_ID",
      "Linked_Entry_ID",
      "Timestamp",
      "Party_Name",
      "Invoice_No",
      "Inward_Type",
      "Pass_Qty",
      "Verified_By",
    ],
  },
  {
    key: "ITEMS",
    label: "Items (Inventory master)",
    settingKey: "SHEET_URL_ITEMS",
    headers: [
      "SKU",
      "Item_Name",
      "Category",
      "Size_Unit",
      "UOM",
      "Rate",
      "ADC_Manual",
      "Lead_Time_Days",
      "Safety_Factor",
      "MOQ",
      "Max_Level",
      "Location",
      "Status",
      "Created_At",
      "Created_By",
    ],
  },
  {
    key: "STOCK_LEDGER",
    label: "Stock Ledger",
    settingKey: "SHEET_URL_STOCK_LEDGER",
    headers: [
      "Txn_ID",
      "Timestamp",
      "SKU",
      "Direction",
      "Quantity",
      "UOM",
      "Source",
      "Reference_ID",
      "Location",
      "Issued_To",
      "Remark",
      "User_ID",
    ],
  },
];

export function getModuleDefinition(moduleKey: string): ModuleDefinition {
  const def = MODULE_SHEETS.find((m) => m.key === moduleKey);
  if (!def) throw new Error(`Unknown module: ${moduleKey}`);
  return def;
}

/** Maps a record to a row array in the module's declared header order — the same shape
 * every domain module (tasks, inward, etc.) needs for append/update calls. */
export function recordToRow<T extends object>(moduleKey: string, record: T): string[] {
  const def = getModuleDefinition(moduleKey);
  const dict = record as unknown as Record<string, string>;
  return def.headers.map((h) => dict[h] ?? "");
}

interface ResolvedTarget {
  spreadsheetId: string;
  sheetTitle: string;
}

/**
 * A module whose sheet the organization has not connected yet. Distinct from a real
 * failure: a freshly signed-up org legitimately has none of these connected, and its
 * pages should invite it to finish onboarding rather than render an error.
 */
export class ModuleNotConfiguredError extends Error {
  constructor(
    readonly moduleKey: string,
    readonly label: string
  ) {
    super(
      `"${label}" ka Google Sheet abhi configure nahi hua hai. Admin > Settings me jaake iska URL paste karein.`
    );
    this.name = "ModuleNotConfiguredError";
  }
}

/** Runs a module read, returning null when that module's sheet is not connected yet. */
export async function tryModule<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ModuleNotConfiguredError) return null;
    throw error;
  }
}

async function resolveModuleTarget(moduleKey: string): Promise<ResolvedTarget> {
  const def = getModuleDefinition(moduleKey);
  const orgId = await getTenantOrgId();

  // Scoped to the org: every tenant connects a different spreadsheet under the same
  // module key, so an unscoped key would point one org's writes at another's sheet.
  return tenantCached(orgId, `module-target:${moduleKey}`, 60_000, async () => {
    const url = await getSetting(def.settingKey);
    if (!url) {
      throw new ModuleNotConfiguredError(moduleKey, def.label);
    }

    const spreadsheetId = extractSpreadsheetId(url);
    if (!spreadsheetId) {
      throw new Error(`"${def.label}" ke liye saved URL invalid hai.`);
    }

    const gid = extractGid(url);
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetList = meta.data.sheets ?? [];
    const target =
      (gid !== null ? sheetList.find((s) => s.properties?.sheetId === gid) : sheetList[0]) ??
      sheetList[0];

    if (!target?.properties?.title) {
      throw new Error(`"${def.label}" sheet me koi tab nahi mila.`);
    }

    return { spreadsheetId, sheetTitle: target.properties.title };
  });
}

// Tracks which (spreadsheet, tab) pairs are already known to have a header row,
// so we only pay for the extra read once per warm server instance.
const headerEnsured = new Set<string>();

async function ensureHeaderRow(target: ResolvedTarget, headers: string[]): Promise<void> {
  const cacheKey = `${target.spreadsheetId}:${target.sheetTitle}`;
  if (headerEnsured.has(cacheKey)) return;

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: target.spreadsheetId,
    range: `${target.sheetTitle}!1:1`,
  });

  const existingHeader = res.data.values?.[0] ?? [];
  if (existingHeader.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: target.spreadsheetId,
      range: `${target.sheetTitle}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  headerEnsured.add(cacheKey);
}

// One check per warm instance per (spreadsheet, tab) — the header only ever grows.
const headersMigrated = new Set<string>();

/**
 * Adds any column this code knows about that the connected sheet's header row is
 * missing.
 *
 * Rows are read back by matching against the sheet's *own* header row, so a column
 * added to a module definition after an organization already connected its sheet would
 * be written into a position no header names — invisible on read. This makes adding a
 * column a code change rather than an instruction sent to every customer.
 */
export async function ensureModuleHeaders(moduleKey: string): Promise<void> {
  const def = getModuleDefinition(moduleKey);
  const target = await resolveModuleTarget(moduleKey);
  const cacheKey = `${target.spreadsheetId}:${target.sheetTitle}`;
  if (headersMigrated.has(cacheKey)) return;

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: target.spreadsheetId,
    range: `${target.sheetTitle}!1:1`,
  });

  const existing = (res.data.values?.[0] ?? []) as string[];
  const missing = def.headers.filter((h) => !existing.includes(h));

  if (missing.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: target.spreadsheetId,
      range: `${target.sheetTitle}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...existing, ...missing]] },
    });
  }

  headersMigrated.add(cacheKey);
}

/** Appends a row to a module's connected sheet, creating the header row first if needed. */
export async function appendModuleRow(
  moduleKey: string,
  row: (string | number)[]
): Promise<void> {
  const def = getModuleDefinition(moduleKey);
  const target = await resolveModuleTarget(moduleKey);
  await ensureHeaderRow(target, def.headers);
  await appendSheetRow(target.sheetTitle, row, target.spreadsheetId);
}

export async function getModuleRows<T = Record<string, string>>(
  moduleKey: string
): Promise<T[]> {
  const target = await resolveModuleTarget(moduleKey);
  const rows = await getSheetRows(target.sheetTitle, target.spreadsheetId);
  return rowsToObjects<T>(rows);
}

/** Overwrites a specific row (1-indexed, including header) in a module's connected sheet. */
export async function updateModuleRow(
  moduleKey: string,
  rowNumber: number,
  row: (string | number)[]
): Promise<void> {
  const target = await resolveModuleTarget(moduleKey);
  await updateSheetRow(target.sheetTitle, rowNumber, row, target.spreadsheetId);
}

/** Finds the first data row whose column (0-indexed) matches, e.g. column 0 for an ID lookup. */
export async function findModuleRow<T = Record<string, string>>(
  moduleKey: string,
  matchColumnIndex: number,
  matchValue: string
): Promise<{ rowNumber: number; record: T } | null> {
  const target = await resolveModuleTarget(moduleKey);
  const rows = await getSheetRows(target.sheetTitle, target.spreadsheetId);
  const rowIndex = rows.findIndex((row, i) => i > 0 && row[matchColumnIndex] === matchValue);
  if (rowIndex === -1) return null;

  const record = rowsToObjects<T>([rows[0], rows[rowIndex]])[0];
  return { rowNumber: rowIndex + 1, record };
}

export async function invalidateModuleTarget(moduleKey: string): Promise<void> {
  invalidateTenantCache(await getTenantOrgId(), `module-target:${moduleKey}`);
}

export { verifySheetAccess } from "@/lib/googleSheets";
