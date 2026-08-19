import { getSheetsClient, readRowsBatch } from "@/lib/googleSheets";
import { USERS_HEADERS } from "@/lib/auth/users";

export const SYSTEM_TABS = {
  USERS: "Users",
  SETTINGS: "Settings",
} as const;

const SETTINGS_HEADERS = ["Key", "Value"];

/**
 * Turns a blank spreadsheet an organization just shared with us into a working System
 * sheet: the Users and Settings tabs with their header rows.
 *
 * Onboarding asks for a URL, not for the customer to hand-type ten column names — the
 * step most likely to be got wrong is the one we do ourselves.
 */
export async function bootstrapSystemSheet(spreadsheetId: string): Promise<void> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[]
  );

  const wanted = [SYSTEM_TABS.USERS, SYSTEM_TABS.SETTINGS];
  const missing = wanted.filter((t) => !existing.has(t));

  if (missing.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  const current = await readRowsBatch(spreadsheetId, wanted);
  const writes: { range: string; values: string[][] }[] = [];

  if ((current[SYSTEM_TABS.USERS]?.[0] ?? []).length === 0) {
    writes.push({
      range: `${SYSTEM_TABS.USERS}!A1`,
      values: [USERS_HEADERS as unknown as string[]],
    });
  }
  if ((current[SYSTEM_TABS.SETTINGS]?.[0] ?? []).length === 0) {
    writes.push({ range: `${SYSTEM_TABS.SETTINGS}!A1`, values: [SETTINGS_HEADERS] });
  }

  if (writes.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: writes },
    });
  }
}

/**
 * Whether the sheet already carries another organization's user rows. Two orgs pointing
 * at one spreadsheet would silently share logins, so signup refuses a sheet in use.
 */
export async function systemSheetHasUsers(spreadsheetId: string): Promise<boolean> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const hasUsersTab = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === SYSTEM_TABS.USERS
  );
  if (!hasUsersTab) return false;

  const rows = await readRowsBatch(spreadsheetId, [SYSTEM_TABS.USERS]);
  return (rows[SYSTEM_TABS.USERS]?.length ?? 0) > 1;
}

/** The address an organization must share their spreadsheets and Drive folder with. */
export function getServiceAccountEmail(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable.");
  }
  return email;
}
