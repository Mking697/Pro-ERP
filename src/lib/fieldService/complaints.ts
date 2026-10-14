import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, sql } from "drizzle-orm";
import { complaints, customers, fieldServiceActivities } from "@/db/schema";
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
 * Complaints — a customer-reported issue, punched internally by staff against a
 * Customer Master row (per the user's own explicit choice — no public no-login form,
 * unlike the reference app). Shares the Doer-assignment/3-step-completion mechanism
 * with Service Jobs and Site Visits — see src/db/schema/fieldService.ts.
 */

export class ComplaintError extends Error {}

type ComplaintRow = InferSelectModel<typeof complaints>;

export interface ComplaintRecord {
  id: string;
  complaintNo: number;
  displayNo: string;
  customerId: string;
  customerName: string;
  jobReference: string;
  warrantyStatus: string;
  issueDescription: string;
  siteAddress: string;
  attendantName: string;
  attendantPhone: string;
  attachmentUrl: string;
  mediaUrls: string[];
  status: string;
  currentCycle: number;
  createdBy: string;
  createdAt: string;
  assignments: FieldAssignmentInfo[];
  step: FieldStepRecord | null;
}

function displayNo(n: number): string {
  return `CMP-${String(n).padStart(4, "0")}`;
}

async function rowToRecord(orgId: string, row: ComplaintRow, batch?: BatchDetails): Promise<ComplaintRecord> {
  const details = batch ?? await getBatchDetails(orgId, "COMPLAINT", [row]);
  const customer = details.customers.get(row.customerId);
  const assignMap = details.assignments;
  const step = details.steps.get(row.id) ?? null;
  return {
    id: row.id,
    complaintNo: row.complaintNo,
    displayNo: displayNo(row.complaintNo),
    customerId: row.customerId,
    customerName: customer?.customerName ?? "",
    jobReference: row.jobReference,
    warrantyStatus: row.warrantyStatus,
    issueDescription: row.issueDescription,
    siteAddress: row.siteAddress,
    attendantName: row.attendantName,
    attendantPhone: row.attendantPhone,
    attachmentUrl: row.attachmentUrl,
    mediaUrls: Array.isArray(row.mediaUrls) ? (row.mediaUrls as string[]) : [],
    status: row.status,
    currentCycle: row.currentCycle,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    assignments: assignMap.get(row.id) ?? [],
    step,
  };
}

/** Reads the current highest complaintNo for this org and allocates the next one —
 * same "read max + 1, retry on a real unique-constraint collision" pattern as
 * quotations.quotationNo / dispatch.gatePassNo (see those files for why no DB serial). */
async function nextComplaintNo(orgId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${complaints.complaintNo}), 0)` })
    .from(complaints)
    .where(eq(complaints.orgId, orgId));
  const max = Number(row?.max ?? 0);
  if (!Number.isSafeInteger(max) || max < 0 || max >= 2147483647) throw new ComplaintError("Number allocation unavailable.");
  return max + 1;
}

export interface CreateComplaintInput {
  customerId: string;
  jobReference?: string;
  warrantyStatus: "In_Warranty" | "Out_Of_Warranty";
  issueDescription: string;
  siteAddress?: string;
  attendantName?: string;
  attendantPhone?: string;
  attachmentUrl?: string;
  mediaUrls?: string[];
}

export async function createComplaint(input: CreateComplaintInput, actorId: string): Promise<ComplaintRecord> {
  const orgId = await getTenantOrgId();
  input = validateCreate("COMPLAINT", input, orgId);
  return runInTenantTransaction(orgId, async () => {
  if (!input.customerId.trim()) throw new ComplaintError("Customer chunna zaroori hai.");
  if (!input.issueDescription.trim()) throw new ComplaintError("Issue description likhna zaroori hai.");
  const customer = await findById(customers, orgId, input.customerId);
  if (!customer || customer.status !== "Active") throw new ComplaintError("Active customer nahi mila.");

  const id = generateId("CMP");
  const row = await insertRecord(complaints, {
        id,
        orgId,
        complaintNo: await nextComplaintNo(orgId),
        customerId: input.customerId,
        jobReference: input.jobReference?.trim() ?? "",
        warrantyStatus: input.warrantyStatus,
        issueDescription: input.issueDescription.trim(),
        siteAddress: input.siteAddress?.trim() ?? "",
        attendantName: input.attendantName?.trim() ?? "",
        attendantPhone: input.attendantPhone?.trim() ?? "",
        attachmentUrl: input.attachmentUrl?.trim() ?? "",
        mediaUrls: input.mediaUrls ?? [],
        status: "Pending",
    createdBy: actorId,
      });

  await logFieldServiceActivity(orgId, "COMPLAINT", id, "Created", `Complaint "${customer.customerName}" ke liye register hui.`, actorId);
  return rowToRecord(orgId, row);
  });
}

export async function getComplaint(id: string): Promise<ComplaintRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(complaints, orgId, id);
  return row ? rowToRecord(orgId, row) : null;
}

export async function listComplaints(doerIdFilter?: string): Promise<ComplaintRecord[]> {
  const orgId = await getTenantOrgId();
  let rows = await listByOrg(complaints, orgId);
  if (doerIdFilter) {
    const assigned = await getAssignedTaskIds(orgId, "COMPLAINT", doerIdFilter);
    rows = rows.filter((r) => assigned.has(r.id));
  }
  const batch = await getBatchDetails(orgId, "COMPLAINT", rows);
  const records = await Promise.all(rows.map((r) => rowToRecord(orgId, r, batch)));
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listComplaintActivities(id: string) {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(fieldServiceActivities)
    .where(and(eq(fieldServiceActivities.orgId, orgId), eq(fieldServiceActivities.taskType, "COMPLAINT"), eq(fieldServiceActivities.taskId, id)))
    .orderBy(desc(fieldServiceActivities.createdAt));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    actorId: r.actorId,
    createdAt: r.createdAt.toISOString(),
  }));
}
