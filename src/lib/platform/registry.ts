import {
  getSheetsClient,
  readRows,
  readRowsBatch,
  appendRow,
  updateRow,
  rowsToObjects,
  deleteRow,
} from "@/lib/googleSheets";
import { cached, invalidateCache } from "@/lib/cache";
import { generateId, slugify } from "@/lib/id";
import { nowStamp } from "@/lib/timestamp";

/**
 * The platform registry is the one spreadsheet Pro ERP itself owns — it holds no
 * business data, only the map of which organization exists and which System sheet
 * belongs to it. Every organization's actual data lives in their own spreadsheet,
 * which they connect by pasting a URL.
 */
export const ORGANIZATIONS_TAB = "Organizations";
export const USERS_INDEX_TAB = "Users_Index";

export const ORGANIZATIONS_HEADERS = [
  "Org_ID",
  "Org_Name",
  "Slug",
  "System_Sheet_ID",
  "Owner_Email",
  "Plan",
  "Status",
  "Created_At",
] as const;

export const USERS_INDEX_HEADERS = ["Email", "Org_ID", "User_ID", "Status"] as const;

export interface Organization {
  Org_ID: string;
  Org_Name: string;
  Slug: string;
  System_Sheet_ID: string;
  Owner_Email: string;
  Plan: string;
  Status: string;
  Created_At: string;
}

export interface UserIndexEntry {
  Email: string;
  Org_ID: string;
  User_ID: string;
  Status: string;
}

const ORGS_CACHE_KEY = "platform:organizations";
const INDEX_CACHE_KEY = "platform:users-index";
const REGISTRY_TTL_MS = 30_000;

export function getPlatformSheetId(): string {
  const id = process.env.PLATFORM_SHEET_ID;
  if (!id) {
    throw new Error(
      "Missing PLATFORM_SHEET_ID environment variable — this is the spreadsheet that lists every organization."
    );
  }
  return id;
}

/**
 * Creates the two registry tabs and their header rows if they are missing, so a fresh
 * install only needs a blank spreadsheet shared with the service account.
 */
export async function ensurePlatformSheet(): Promise<void> {
  const spreadsheetId = getPlatformSheetId();
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean) as string[]
  );

  const missing = [ORGANIZATIONS_TAB, USERS_INDEX_TAB].filter((t) => !existing.has(t));
  if (missing.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  const current = await readRowsBatch(spreadsheetId, [ORGANIZATIONS_TAB, USERS_INDEX_TAB]);
  const headerWrites: { range: string; values: string[][] }[] = [];

  if ((current[ORGANIZATIONS_TAB]?.[0] ?? []).length === 0) {
    headerWrites.push({
      range: `${ORGANIZATIONS_TAB}!A1`,
      values: [[...ORGANIZATIONS_HEADERS]],
    });
  }
  if ((current[USERS_INDEX_TAB]?.[0] ?? []).length === 0) {
    headerWrites.push({
      range: `${USERS_INDEX_TAB}!A1`,
      values: [[...USERS_INDEX_HEADERS]],
    });
  }

  if (headerWrites.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: headerWrites },
    });
  }
}

export async function listOrganizations(): Promise<Organization[]> {
  return cached(ORGS_CACHE_KEY, REGISTRY_TTL_MS, async () => {
    const rows = await readRows(getPlatformSheetId(), ORGANIZATIONS_TAB);
    return rowsToObjects<Organization>(rows);
  });
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const orgs = await listOrganizations();
  return orgs.find((o) => o.Org_ID === orgId) ?? null;
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const orgs = await listOrganizations();
  const normalized = slug.trim().toLowerCase();
  return orgs.find((o) => o.Slug?.trim().toLowerCase() === normalized) ?? null;
}

/** Login's first hop: which organization does this email belong to? */
export async function lookupUserOrg(email: string): Promise<UserIndexEntry | null> {
  const entries = await cached(INDEX_CACHE_KEY, REGISTRY_TTL_MS, async () => {
    const rows = await readRows(getPlatformSheetId(), USERS_INDEX_TAB);
    return rowsToObjects<UserIndexEntry>(rows);
  });

  const normalized = email.trim().toLowerCase();
  return entries.find((e) => e.Email?.trim().toLowerCase() === normalized) ?? null;
}

/**
 * Emails are unique across the whole platform, not just within one org — the login form
 * only asks for an email, so the same address in two organizations would be ambiguous.
 */
export async function isEmailTaken(email: string): Promise<boolean> {
  return (await lookupUserOrg(email)) !== null;
}

export async function indexUser(entry: UserIndexEntry): Promise<void> {
  await appendRow(getPlatformSheetId(), USERS_INDEX_TAB, [
    entry.Email.trim().toLowerCase(),
    entry.Org_ID,
    entry.User_ID,
    entry.Status,
  ]);
  invalidateCache(INDEX_CACHE_KEY);
}

/** Keeps the index's Status column in step with the org's own Users tab. */
export async function updateIndexedUserStatus(email: string, status: string): Promise<void> {
  const spreadsheetId = getPlatformSheetId();
  const rows = await readRows(spreadsheetId, USERS_INDEX_TAB);
  const normalized = email.trim().toLowerCase();
  const rowIndex = rows.findIndex(
    (row, i) => i > 0 && row[0]?.trim().toLowerCase() === normalized
  );
  if (rowIndex === -1) return;

  const row = rows[rowIndex];
  await updateRow(spreadsheetId, USERS_INDEX_TAB, rowIndex + 1, [
    row[0] ?? "",
    row[1] ?? "",
    row[2] ?? "",
    status,
  ]);
  invalidateCache(INDEX_CACHE_KEY);
}

/**
 * Removes an email from the platform index, freeing it for reuse.
 *
 * Sign-in looks up which organization an email belongs to here, so an entry left behind
 * would keep that address claimed across the whole platform even though the user is gone.
 */
export async function removeIndexedUser(email: string): Promise<void> {
  const spreadsheetId = getPlatformSheetId();
  const rows = await readRows(spreadsheetId, USERS_INDEX_TAB);
  const normalized = email.trim().toLowerCase();
  const rowIndex = rows.findIndex(
    (row, i) => i > 0 && row[0]?.trim().toLowerCase() === normalized
  );
  if (rowIndex === -1) return;

  await deleteRow(spreadsheetId, USERS_INDEX_TAB, rowIndex + 1);
  invalidateCache(INDEX_CACHE_KEY);
}

/**
 * Removes an organization from the registry, along with every email it had claimed.
 *
 * Nothing in the organization's own Google Sheets is touched — those belong to them, and
 * this platform has no business deleting a customer's records. What this does is end the
 * tenancy: the org can no longer be resolved, so nobody can sign in to it, and its emails
 * become available again.
 */
export async function deleteOrganization(orgId: string): Promise<void> {
  const spreadsheetId = getPlatformSheetId();

  // Emails first. If this half fails, the organization is still reachable and can be
  // retried; doing it the other way round would strand entries pointing at nothing.
  const indexRows = await readRows(spreadsheetId, USERS_INDEX_TAB);
  for (let i = indexRows.length - 1; i > 0; i--) {
    if (indexRows[i]?.[1] === orgId) {
      // Deleting bottom-up keeps the rows above at the numbers already read.
      await deleteRow(spreadsheetId, USERS_INDEX_TAB, i + 1);
    }
  }

  const orgRows = await readRows(spreadsheetId, ORGANIZATIONS_TAB);
  const rowIndex = orgRows.findIndex((row, i) => i > 0 && row[0] === orgId);
  if (rowIndex === -1) {
    throw new Error("Organization nahi mili.");
  }
  await deleteRow(spreadsheetId, ORGANIZATIONS_TAB, rowIndex + 1);

  invalidateCache(INDEX_CACHE_KEY);
  invalidateCache(ORGS_CACHE_KEY);
}

interface CreateOrganizationInput {
  orgName: string;
  systemSheetId: string;
  ownerEmail: string;
}

export async function createOrganization(
  input: CreateOrganizationInput
): Promise<Organization> {
  const orgs = await listOrganizations();

  // Two orgs called "Acme" must not collide on the slug.
  const base = slugify(input.orgName);
  const taken = new Set(orgs.map((o) => o.Slug?.trim().toLowerCase()));
  let slug = base;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n++}`;
  }

  const org: Organization = {
    Org_ID: generateId("ORG"),
    Org_Name: input.orgName.trim(),
    Slug: slug,
    System_Sheet_ID: input.systemSheetId,
    Owner_Email: input.ownerEmail.trim().toLowerCase(),
    Plan: "Free",
    Status: "Active",
    Created_At: nowStamp(),
  };

  await appendRow(
    getPlatformSheetId(),
    ORGANIZATIONS_TAB,
    ORGANIZATIONS_HEADERS.map((h) => org[h])
  );
  invalidateCache(ORGS_CACHE_KEY);
  return org;
}

export async function updateOrganization(
  orgId: string,
  patch: Partial<Omit<Organization, "Org_ID" | "Created_At">>
): Promise<Organization> {
  const spreadsheetId = getPlatformSheetId();
  const rows = await readRows(spreadsheetId, ORGANIZATIONS_TAB);
  const rowIndex = rows.findIndex((row, i) => i > 0 && row[0] === orgId);
  if (rowIndex === -1) {
    throw new Error("Organization nahi mila.");
  }

  const current = rowsToObjects<Organization>([rows[0], rows[rowIndex]])[0];
  const updated: Organization = { ...current, ...patch };

  await updateRow(
    spreadsheetId,
    ORGANIZATIONS_TAB,
    rowIndex + 1,
    ORGANIZATIONS_HEADERS.map((h) => updated[h])
  );
  invalidateCache(ORGS_CACHE_KEY);
  return updated;
}
