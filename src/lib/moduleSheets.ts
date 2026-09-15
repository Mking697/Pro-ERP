import {
  getSheetsClient,
  getSheetRows,
  updateCells,
  appendSheetRow,
  appendSheetRows,
  updateSheetRow,
  deleteRow,
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
      // Who made the entry. Added after the fact: the sheet recorded who *verified* an
      // entry but never who raised it, so an inward report could not be narrowed to a
      // person's own work. ensureModuleHeaders() appends it to sheets already connected.
      "Created_By",
      // TAT/deadline for the IQC check — added after the fact, same as Created_By above.
      // No column here changes what IQC_Status/Verified_By/routing already mean; these
      // three are purely additive, computed once at entry creation.
      "IQC_TAT_Value",
      "IQC_TAT_Unit",
      "IQC_Deadline",
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
  {
    key: "INDENTS",
    label: "Indents (Purchase requests)",
    settingKey: "SHEET_URL_INDENTS",
    headers: [
      "Indent_ID",
      "Timestamp",
      "SKU",
      "Item_Name",
      "Suggested_Qty",
      "Final_Qty",
      "UOM",
      "Reason",
      "Linked_Plan_ID",
      "Status",
      "Requested_By",
      "Approved_By",
      "Approved_At",
      "Expected_Date",
      "Received_Qty",
      "Received_At",
    ],
  },
  {
    key: "BOM",
    label: "BOM (Bill of Materials)",
    settingKey: "SHEET_URL_BOM",
    headers: [
      "BOM_ID",
      "Product_Name",
      "Product_SKU",
      "Version",
      "Line_No",
      "Component_SKU",
      "Component_Name",
      "Component_Type",
      "Qty_Per_Unit",
      "UOM",
      "Status",
      "Created_At",
      "Created_By",
    ],
  },
  {
    key: "PRODUCTION_PLANS",
    label: "Production Plans (PPC)",
    settingKey: "SHEET_URL_PRODUCTION_PLANS",
    headers: [
      "Plan_ID",
      "Timestamp",
      "Product_Name",
      "Product_SKU",
      "BOM_ID",
      "BOM_Version",
      "Planned_Qty",
      "Production_Date",
      "Status",
      "Actual_Qty",
      "Started_By",
      "Started_At",
      "Created_By",
      "Notes",
      // Appended at the end, never inserted mid-header (see Outcome_Type above for why).
      // Job_No is a second, purely user-facing identifier — Plan_ID stays the real key
      // every lookup joins on, so nothing that already reads Plan_ID had to change.
      "Job_No",
      // Manually typed, e.g. a customer's PO number — free text, not validated against
      // anything, since there is no Sales Order module yet to validate it against.
      "Order_No",
      // Which FMS Template ("Line") Start Production should run for this plan. Blank
      // keeps the old behaviour: every Active template triggered on PRODUCTION_STARTED
      // fires for every plan. Set, and only this one template starts — see the "start"
      // action in api/ppc/plans/[planId]/route.ts.
      "FMS_Template_ID",
    ],
  },
  {
    key: "PLAN_MATERIALS",
    label: "Plan Materials (PPC)",
    settingKey: "SHEET_URL_PLAN_MATERIALS",
    headers: [
      "Plan_ID",
      "SKU",
      "Item_Name",
      "Qty_Per_Unit",
      "Required_Qty",
      "UOM",
      "Allocated_Qty",
      "Shortage_Qty",
      "Consumed_Qty",
      "Status",
      "Created_At",
    ],
  },
  {
    key: "FMS_TEMPLATES",
    label: "FMS Templates",
    settingKey: "SHEET_URL_FMS_TEMPLATES",
    headers: [
      // One row per step, grouped by Template_ID — same flat-rows-by-group shape as BOM,
      // so a template's metadata (name, trigger, status) repeats on every one of its rows
      // rather than living in a separate header sheet.
      "Template_ID",
      "Template_Name",
      "Trigger_Event",
      "Status",
      "Created_By",
      "Created_At",
      "Step_No",
      "Step_Name",
      "Assigned_To",
      "TAT_Value",
      "TAT_Unit",
      "Outcome_Options",
      "Next_Step_Map",
      // Where this step's data comes from (a custom form, or a live pull from another
      // connected sheet) and what its outcome should do (e.g. write a stock movement) —
      // both optional, both JSON. ensureModuleHeaders() migrates sheets connected earlier.
      "Data_Source_Type",
      "Data_Source_Config",
      "Action_Type",
      "Action_Config",
      // Which built-in response preset (Done/Pass-Fail/Pass Qty & Fail Qty/Number/Text/
      // Attachment) the step's Outcome_Options and Data Source form were generated from —
      // "" for a template built before this existed, or a genuinely custom outcome list.
      // Appended at the end, never inserted mid-header — see the REPORT_SHARES_HEADERS
      // lesson: a header appended anywhere else breaks every sheet connected earlier.
      "Outcome_Type",
      // A step's deadline is normally just TAT_Value/TAT_Unit, fixed at template-build
      // time. These three make it computable instead: blank TAT_Source_Step_No keeps the
      // fixed behaviour; set, and the deadline is read from that earlier step's own
      // Form_Data field (TAT_Source_Field_Key) plus TAT_Offset, in TAT_Unit — e.g. a
      // purchase flow's "Lead Days" typed into step 1 driving a "follow up" step at
      // Lead Days − 1 and a "received" step at Lead Days, from one number typed once.
      // TAT_Value stays as the fallback if the source can't be resolved.
      "TAT_Source_Step_No",
      "TAT_Source_Field_Key",
      "TAT_Offset",
    ],
  },
  {
    key: "FMS_RUNS",
    label: "FMS Runs",
    settingKey: "SHEET_URL_FMS_RUNS",
    headers: [
      // One row per step execution, grouped by Instance_ID.
      "Run_ID",
      "Instance_ID",
      "Template_ID",
      "Template_Name",
      "Context_Ref",
      "Started_By",
      "Started_At",
      "Step_No",
      "Step_Name",
      "Assigned_To",
      "Created_At",
      "TAT_Start",
      "TAT_Deadline",
      "Completed_At",
      "Completed_By",
      "Outcome",
      "Status",
      "Remark",
      // Whatever the completer typed into the step's own Data Source form, JSON-encoded.
      "Form_Data",
      // How many physical units this specific run is handling — blank for a flow that
      // never tracks quantity. Carried forward step to step; a PASS_FAIL_QTY step's Fail
      // Qty spawns a new run at the same step with this set to the failed quantity, so a
      // partial rework never loses track of how many units it covers. Appended at the
      // end, never inserted mid-header — see the Outcome_Type column above.
      "Quantity",
    ],
  },
  {
    key: "FMS_WEEKOFF_OVERRIDES",
    label: "FMS Week-off Overrides",
    settingKey: "SHEET_URL_FMS_WEEKOFF_OVERRIDES",
    headers: ["Override_ID", "Date", "Scope", "Scope_Value", "Created_By", "Created_At"],
  },
  {
    key: "VENDORS",
    label: "Vendor Master",
    settingKey: "SHEET_URL_VENDORS",
    headers: [
      "Vendor_ID",
      "Vendor_Name",
      "Contact_Person",
      "Phone",
      "Email",
      "GSTIN",
      "Address",
      "City",
      "State",
      "Payment_Terms",
      "Bank_Name",
      "Bank_Account_No",
      "IFSC",
      "Status",
      "Created_At",
      "Created_By",
    ],
  },
  {
    key: "CUSTOMERS",
    label: "Customer Master",
    settingKey: "SHEET_URL_CUSTOMERS",
    headers: [
      "Customer_ID",
      "Customer_Name",
      "Contact_Person",
      "Phone",
      "Email",
      "GSTIN",
      "Billing_Address",
      "Shipping_Address",
      "City",
      "State",
      "Credit_Terms",
      "Status",
      "Created_At",
      "Created_By",
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

/** Appends many rows to a module's sheet in one call, header ensured first. */
export async function appendModuleRows(
  moduleKey: string,
  rows: (string | number)[][]
): Promise<void> {
  if (rows.length === 0) return;
  const def = getModuleDefinition(moduleKey);
  const target = await resolveModuleTarget(moduleKey);
  await ensureHeaderRow(target, def.headers);
  await appendSheetRows(target.sheetTitle, rows, target.spreadsheetId);
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

/**
 * Permanently removes specific rows (1-indexed, including header) from a module's
 * connected sheet — highest row number first, since deleting one shifts every row below
 * it up by one, and resolving row numbers fresh after each delete would cost one Sheets
 * read per row for no reason.
 */
export async function deleteModuleRows(moduleKey: string, rowNumbers: number[]): Promise<void> {
  if (rowNumbers.length === 0) return;
  const target = await resolveModuleTarget(moduleKey);
  const sorted = [...rowNumbers].sort((a, b) => b - a);
  for (const rowNumber of sorted) {
    await deleteRow(target.spreadsheetId, target.sheetTitle, rowNumber);
  }
}

/**
 * Maps a key column's value to its 1-indexed sheet row, in a single read.
 *
 * A bulk edit needs the row number of every item it touches; resolving them one lookup
 * at a time would read the whole sheet once per row.
 */
export async function getModuleRowNumbers(
  moduleKey: string,
  matchColumnIndex: number
): Promise<Map<string, number>> {
  const target = await resolveModuleTarget(moduleKey);
  const rows = await getSheetRows(target.sheetTitle, target.spreadsheetId);

  const index = new Map<string, number>();
  rows.forEach((row, i) => {
    if (i === 0) return;
    const key = row[matchColumnIndex];
    // First occurrence wins; a duplicate key is a data problem the item master already
    // refuses to create, and silently preferring the later row would hide it.
    if (key && !index.has(key)) index.set(key, i + 1);
  });

  return index;
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

/**
 * Patches specific fields on many rows of a module sheet in one API call.
 *
 * `rows` maps a row number (1-indexed, header included) to the field names and values to
 * set on it. Only those cells are written — the rest of each row is left alone.
 */
export async function updateModuleCells(
  moduleKey: string,
  rows: { rowNumber: number; fields: Record<string, string | number> }[]
): Promise<void> {
  const def = getModuleDefinition(moduleKey);
  const target = await resolveModuleTarget(moduleKey);

  const updates = rows.flatMap((row) =>
    Object.entries(row.fields)
      .map(([field, value]) => {
        const columnIndex = def.headers.indexOf(field);
        // A field this module does not declare would land in an unnamed column and be
        // invisible on read, so it is dropped rather than written to the wrong place.
        if (columnIndex === -1) return null;
        return { rowNumber: row.rowNumber, columnIndex, value };
      })
      .filter(
        (u): u is { rowNumber: number; columnIndex: number; value: string | number } =>
          u !== null
      )
  );

  await updateCells(target.spreadsheetId, target.sheetTitle, updates);
}

export async function invalidateModuleTarget(moduleKey: string): Promise<void> {
  invalidateTenantCache(await getTenantOrgId(), `module-target:${moduleKey}`);
}

export { verifySheetAccess } from "@/lib/googleSheets";
