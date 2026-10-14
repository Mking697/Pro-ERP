import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, sql } from "drizzle-orm";
import { siteVisits, customers, fieldServiceActivities } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { findById, insertRecord, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { validateCreate } from "./validation";
import { getBatchDetails, type BatchDetails } from "./reads";
import { getAssignedTaskIds, type FieldAssignmentInfo } from "@/lib/fieldService/assignments";
import { type FieldStepRecord } from "@/lib/fieldService/steps";
import { logFieldServiceActivity } from "@/lib/fieldService/core";

/**
 * Site Visits — an inspection/survey visit, raised internally by staff (Admin/MD/
 * Delegator) from the dashboard, against a Customer Master row. Shares the
 * Doer-assignment/3-step-completion mechanism with Service Jobs and Complaints — see
 * src/db/schema/fieldService.ts. Step 2 of this flow (unlike the other two) is written
 * notes + an optional site chart/calculation upload rather than a single evidence file.
 */

export class SiteVisitError extends Error {}

type SiteVisitRow = InferSelectModel<typeof siteVisits>;

export interface SiteVisitRecord {
  id: string;
  serialNo: number;
  displayNo: string;
  customerId: string;
  customerName: string;
  raisedVia: string;
  raisedByName: string;
  siteAddress: string;
  siteLatitude: number | null;
  siteLongitude: number | null;
  attendantName: string;
  attendantPhone: string;
  visitFor: string;
  status: string;
  currentCycle: number;
  createdBy: string;
  createdAt: string;
  assignments: FieldAssignmentInfo[];
  step: FieldStepRecord | null;
}

function displayNo(n: number): string {
  return `SV-${String(n).padStart(4, "0")}`;
}

async function rowToRecord(orgId: string, row: SiteVisitRow, batch?: BatchDetails): Promise<SiteVisitRecord> {
  const details = batch ?? await getBatchDetails(orgId, "SITE_VISIT", [row]);
  const customer = details.customers.get(row.customerId);
  const assignMap = details.assignments;
  const step = details.steps.get(row.id) ?? null;
  return {
    id: row.id,
    serialNo: row.serialNo,
    displayNo: displayNo(row.serialNo),
    customerId: row.customerId,
    customerName: customer?.customerName ?? "",
    raisedVia: row.raisedVia,
    raisedByName: row.raisedByName,
    siteAddress: row.siteAddress,
    siteLatitude: row.siteLatitude !== null ? Number(row.siteLatitude) : null,
    siteLongitude: row.siteLongitude !== null ? Number(row.siteLongitude) : null,
    attendantName: row.attendantName,
    attendantPhone: row.attendantPhone,
    visitFor: row.visitFor,
    status: row.status,
    currentCycle: row.currentCycle,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    assignments: assignMap.get(row.id) ?? [],
    step,
  };
}

async function nextSerialNo(orgId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${siteVisits.serialNo}), 0)` })
    .from(siteVisits)
    .where(eq(siteVisits.orgId, orgId));
  const max = Number(row?.max ?? 0);
  if (!Number.isSafeInteger(max) || max < 0 || max >= 2147483647) throw new SiteVisitError("Number allocation unavailable.");
  return max + 1;
}

export interface CreateSiteVisitInput {
  customerId: string;
  raisedVia?: string;
  raisedByName?: string;
  siteAddress?: string;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
  attendantName?: string;
  attendantPhone?: string;
  visitFor: "Installation_Check" | "Quality_Complaint" | "Sales_Demo" | "Other";
}

export async function createSiteVisit(input: CreateSiteVisitInput, actorId: string): Promise<SiteVisitRecord> {
  const orgId = await getTenantOrgId();
  input = validateCreate("SITE_VISIT", input, orgId);
  return runInTenantTransaction(orgId, async () => {
  if (!input.customerId.trim()) throw new SiteVisitError("Customer chunna zaroori hai.");
  const customer = await findById(customers, orgId, input.customerId);
  if (!customer || customer.status !== "Active") throw new SiteVisitError("Active customer nahi mila.");

  const id = generateId("SVT");
  const row = await insertRecord(siteVisits, {
        id,
        orgId,
        serialNo: await nextSerialNo(orgId),
        customerId: input.customerId,
        raisedVia: input.raisedVia?.trim() ?? "",
        raisedByName: input.raisedByName?.trim() ?? "",
        siteAddress: input.siteAddress?.trim() ?? "",
        siteLatitude: input.siteLatitude != null ? String(input.siteLatitude) : null,
        siteLongitude: input.siteLongitude != null ? String(input.siteLongitude) : null,
        attendantName: input.attendantName?.trim() ?? "",
        attendantPhone: input.attendantPhone?.trim() ?? "",
        visitFor: input.visitFor,
        status: "Pending",
    createdBy: actorId,
      });

  await logFieldServiceActivity(orgId, "SITE_VISIT", id, "Created", `Site Visit "${customer.customerName}" ke liye bani.`, actorId);
  return rowToRecord(orgId, row);
  });
}

export async function getSiteVisit(id: string): Promise<SiteVisitRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(siteVisits, orgId, id);
  return row ? rowToRecord(orgId, row) : null;
}

export async function listSiteVisits(doerIdFilter?: string): Promise<SiteVisitRecord[]> {
  const orgId = await getTenantOrgId();
  let rows = await listByOrg(siteVisits, orgId);
  if (doerIdFilter) {
    const assigned = await getAssignedTaskIds(orgId, "SITE_VISIT", doerIdFilter);
    rows = rows.filter((r) => assigned.has(r.id));
  }
  const batch = await getBatchDetails(orgId, "SITE_VISIT", rows);
  const records = await Promise.all(rows.map((r) => rowToRecord(orgId, r, batch)));
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listSiteVisitActivities(id: string) {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(fieldServiceActivities)
    .where(and(eq(fieldServiceActivities.orgId, orgId), eq(fieldServiceActivities.taskType, "SITE_VISIT"), eq(fieldServiceActivities.taskId, id)))
    .orderBy(desc(fieldServiceActivities.createdAt));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    actorId: r.actorId,
    createdAt: r.createdAt.toISOString(),
  }));
}
