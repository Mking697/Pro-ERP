import { randomBytes } from "node:crypto";
import {
  appendRow,
  deleteRow,
  getSheetsClient,
  readRows,
  rowsToObjects,
} from "@/lib/googleSheets";
import { cached, invalidateCache } from "@/lib/cache";
import { getPlatformSheetId } from "@/lib/platform/registry";

/**
 * Public, read-only report links.
 *
 * These live in the platform registry rather than in each organization's own sheet for
 * one reason: a visitor arrives with nothing but a token, so resolving it from a
 * per-organization sheet would mean reading every organization's sheet to find the owner.
 * The registry is already the one global map — this is the same job `Users_Index` does
 * for email addresses.
 */
export const REPORT_SHARES_TAB = "Report_Shares";

export const REPORT_SHARES_HEADERS = [
  "Token",
  "Org_ID",
  "Label",
  "Range_Key",
  "From_Date",
  "To_Date",
  "Access",
  "Created_By",
  "Created_At",
  "Status",
] as const;

export interface ReportShare {
  Token: string;
  Org_ID: string;
  Label: string;
  Range_Key: string;
  From_Date: string;
  To_Date: string;
  /** The grants held at the moment the link was made — see `createReportShare`. */
  Access: string;
  Created_By: string;
  Created_At: string;
  Status: string;
}

const SHARES_CACHE_KEY = "platform:report-shares";
const SHARES_TTL_MS = 30_000;

/**
 * 32 random bytes, url-safe.
 *
 * The link is the only thing standing between a stranger and this report, so the token
 * has to be unguessable rather than merely unique — no counters, no ids, no timestamps.
 */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

async function ensureSharesTab(): Promise<void> {
  const spreadsheetId = getPlatformSheetId();
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === REPORT_SHARES_TAB
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: REPORT_SHARES_TAB } } }],
      },
    });
  }

  const rows = await readRows(spreadsheetId, REPORT_SHARES_TAB);
  if ((rows[0] ?? []).length === 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: `${REPORT_SHARES_TAB}!A1`, values: [[...REPORT_SHARES_HEADERS]] },
        ],
      },
    });
  }
}

async function allShares(): Promise<ReportShare[]> {
  return cached(SHARES_CACHE_KEY, SHARES_TTL_MS, async () => {
    try {
      const rows = await readRows(getPlatformSheetId(), REPORT_SHARES_TAB);
      return rowsToObjects<ReportShare>(rows).filter((s) => s.Token);
    } catch {
      // The tab does not exist until the first link is made; no links is not an error.
      return [];
    }
  });
}

export interface CreateShareInput {
  orgId: string;
  label: string;
  rangeKey: string;
  from?: string;
  to?: string;
  /** The creator's grants, stored as given. */
  access: readonly string[];
  createdBy: string;
}

/**
 * Creates a link and returns its token.
 *
 * The creator's grants are copied onto the link rather than read live at view time. If
 * they were read live, someone later granted access to PPC would silently widen every
 * link they had ever shared — a report handed to an outside supplier months ago would
 * start showing production plans. What was shared stays what was shared.
 */
export async function createReportShare(input: CreateShareInput): Promise<ReportShare> {
  await ensureSharesTab();

  const share: ReportShare = {
    Token: newToken(),
    Org_ID: input.orgId,
    Label: input.label.trim() || "Reports",
    Range_Key: input.rangeKey,
    From_Date: input.from ?? "",
    To_Date: input.to ?? "",
    Access: [...input.access].join(","),
    Created_By: input.createdBy,
    Created_At: new Date().toISOString(),
    Status: "Active",
  };

  await appendRow(
    getPlatformSheetId(),
    REPORT_SHARES_TAB,
    REPORT_SHARES_HEADERS.map((h) => share[h])
  );
  invalidateCache(SHARES_CACHE_KEY);
  return share;
}

/**
 * The active link for this token, or null — revoked, expired and unknown look alike.
 *
 * Deliberately reads the sheet rather than the cache. The cache is per-process, and this
 * runs across several serverless instances, so revoking on one would leave the others
 * serving the link until their own copy expired. A revocation that takes effect "within
 * thirty seconds, depending which server you reach" is not a revocation.
 *
 * The extra read is affordable because the expensive part of the page — the whole report
 * data set — is cached; this is one row lookup in front of it.
 */
export async function getReportShare(token: string): Promise<ReportShare | null> {
  if (!token) return null;
  try {
    const rows = await readRows(getPlatformSheetId(), REPORT_SHARES_TAB);
    const found = rowsToObjects<ReportShare>(rows).find((s) => s.Token === token);
    return found && found.Status === "Active" ? found : null;
  } catch {
    // No tab yet, or the registry is unreachable. Refusing is the safe direction.
    return null;
  }
}

export async function listReportShares(orgId: string): Promise<ReportShare[]> {
  const shares = await allShares();
  return shares
    .filter((s) => s.Org_ID === orgId && s.Status === "Active")
    .sort((a, b) => b.Created_At.localeCompare(a.Created_At));
}

/**
 * Removes a link for good.
 *
 * The row is deleted rather than flagged, so revoking really does mean the token is gone
 * — there is no state left that could accidentally be flipped back to Active.
 */
export async function revokeReportShare(orgId: string, token: string): Promise<void> {
  const spreadsheetId = getPlatformSheetId();
  const rows = await readRows(spreadsheetId, REPORT_SHARES_TAB);

  // Both must match: an organization may only revoke a link that is its own.
  const rowIndex = rows.findIndex(
    (row, i) => i > 0 && row[0] === token && row[1] === orgId
  );
  if (rowIndex === -1) return;

  await deleteRow(spreadsheetId, REPORT_SHARES_TAB, rowIndex + 1);
  invalidateCache(SHARES_CACHE_KEY);
}
