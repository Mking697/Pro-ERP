import { randomBytes } from "node:crypto";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { reportShares } from "@/db/schema";
import { db } from "@/db/client";
import { insertRecord } from "@/db/repo";

/**
 * Public, read-only report links.
 *
 * These live in the platform registry table (`report_shares`, `src/db/schema/platform.ts`)
 * rather than in each organization's own tables, for one reason: a visitor arrives with
 * nothing but a token, so resolving it from a per-organization store would mean scanning
 * every organization's data to find the owner. The registry is already the one global map
 * — this is the same job `usersIndex` does for email addresses.
 *
 * `token` is the table's real primary key, not a `generateId()` id — it is already the
 * credential a visitor holds, there is nothing else to key on. There is no `Status`/status
 * column: revoking deletes the row outright (see `revokeReportShare`), so "the row exists"
 * already means "Active" — a stored status flag would just be one more place for that fact
 * to drift out of sync with the row's real presence.
 */

/**
 * Mirrors the pre-Postgres sheet row shape (same field names, same PascalCase casing)
 * even though the persistence underneath is now the `report_shares` Postgres table — the
 * goal is zero changes at the API routes and `/share/[token]` page, which both read
 * `.Token`, `.Org_ID`, `.Access`, etc. off this type today.
 *
 * `Access` stays a comma-joined string (not the table's real `text[]` column) for the same
 * reason `users.ts` keeps `Module_Access` a string — there is exactly one outside reader
 * (`/share/[token]/page.tsx` does `share.Access.split(",")`), so converting at this file's
 * boundary keeps that call site, and the API route's `access: guard.session.access` input,
 * unchanged.
 */
export interface ReportShare {
  Token: string;
  Org_ID: string;
  /** Which single report this link shows. Blank on links made before reports were split. */
  Report: string;
  Label: string;
  Range_Key: string;
  From_Date: string;
  To_Date: string;
  /** The grants held at the moment the link was made — see `createReportShare`. */
  Access: string;
  Created_By: string;
  Created_At: string;
}

type ReportShareRow = InferSelectModel<typeof reportShares>;

function rowToRecord(row: ReportShareRow): ReportShare {
  return {
    Token: row.token,
    Org_ID: row.orgId,
    Report: row.report,
    Label: row.label,
    Range_Key: row.rangeKey,
    From_Date: row.fromDate,
    To_Date: row.toDate,
    Access: row.access.join(","),
    Created_By: row.createdBy,
    Created_At: row.createdAt.toISOString(),
  };
}

/**
 * 24 random bytes, url-safe.
 *
 * The link is the only thing standing between a stranger and this report, so the token
 * has to be unguessable rather than merely unique — no counters, no ids, no timestamps.
 */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export interface CreateShareInput {
  orgId: string;
  report: string;
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
  const row = await insertRecord(reportShares, {
    token: newToken(),
    orgId: input.orgId,
    report: input.report,
    label: input.label.trim() || "Report",
    rangeKey: input.rangeKey,
    fromDate: input.from ?? "",
    toDate: input.to ?? "",
    access: [...input.access],
    createdBy: input.createdBy,
  });
  return rowToRecord(row);
}

/**
 * The link for this token, or null — revoked, expired and unknown look alike.
 *
 * Deliberately scoped by `token` alone — this call has no org/session context at all (a
 * visitor holds nothing but the token), so it must never add an implicit org filter. There
 * is also no cache in front of this read any more: the old Sheets version noted that a
 * cached read would let a revoked link keep resolving on other serverless instances for up
 * to 30 seconds. This is a plain indexed `WHERE token = $1` against the live table, so a
 * revocation (the row's deletion) is visible on the very next request, everywhere.
 */
export async function getReportShare(token: string): Promise<ReportShare | null> {
  if (!token) return null;
  const rows = await db
    .select()
    .from(reportShares)
    .where(eq(reportShares.token, token))
    .limit(1);
  const found = rows[0];
  return found ? rowToRecord(found) : null;
}

/** Every link belonging to `orgId`, newest first. */
export async function listReportShares(orgId: string): Promise<ReportShare[]> {
  const rows = await db
    .select()
    .from(reportShares)
    .where(eq(reportShares.orgId, orgId))
    .orderBy(desc(reportShares.createdAt));
  return rows.map(rowToRecord);
}

/**
 * Removes a link for good.
 *
 * The row is deleted rather than flagged, so revoking really does mean the token is gone
 * — there is no state left that could accidentally be flipped back to Active.
 *
 * Both `token` and `orgId` must match: an organization may only revoke a link that is its
 * own. This is a real authorization boundary, not just a lookup convenience — without the
 * `orgId` predicate, one tenant could revoke another tenant's link by guessing its token.
 */
export async function revokeReportShare(orgId: string, token: string): Promise<void> {
  await db
    .delete(reportShares)
    .where(and(eq(reportShares.token, token), eq(reportShares.orgId, orgId)));
}
