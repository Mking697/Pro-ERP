import type { InferSelectModel } from "drizzle-orm";
import { desc, eq, and } from "drizzle-orm";
import { serviceJobs, customers, fieldServiceActivities } from "@/db/schema";
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
 * Service Jobs — a service/installation job punched manually against a Customer Master
 * row (mirrors the reference app's own "Installation", minus its Google-Sheet sync —
 * this codebase has no such source, every job here is punched by staff). See
 * src/db/schema/fieldService.ts's header comment for the shared Doer-assignment/
 * 3-step-completion mechanism this shares with Complaints and Site Visits.
 */

export class ServiceJobError extends Error {}

type ServiceJobRow = InferSelectModel<typeof serviceJobs>;

export interface ServiceJobRecord {
  id: string;
  customerId: string;
  customerName: string;
  productDetails: string;
  brand: string;
  siteAddress: string;
  attendantName: string;
  attendantPhone: string;
  status: string;
  currentCycle: number;
  createdBy: string;
  createdAt: string;
  assignments: FieldAssignmentInfo[];
  step: FieldStepRecord | null;
}

async function rowToRecord(orgId: string, row: ServiceJobRow, batch?: BatchDetails): Promise<ServiceJobRecord> {
  const details = batch ?? await getBatchDetails(orgId, "SERVICE", [row]);
  const customer = details.customers.get(row.customerId);
  const assignMap = details.assignments;
  const step = details.steps.get(row.id) ?? null;
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: customer?.customerName ?? "",
    productDetails: row.productDetails,
    brand: row.brand,
    siteAddress: row.siteAddress,
    attendantName: row.attendantName,
    attendantPhone: row.attendantPhone,
    status: row.status,
    currentCycle: row.currentCycle,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    assignments: assignMap.get(row.id) ?? [],
    step,
  };
}

export interface CreateServiceJobInput {
  customerId: string;
  productDetails?: string;
  brand?: string;
  siteAddress?: string;
  attendantName?: string;
  attendantPhone?: string;
}

export async function createServiceJob(input: CreateServiceJobInput, actorId: string): Promise<ServiceJobRecord> {
  const orgId = await getTenantOrgId();
  input = validateCreate("SERVICE", input, orgId);
  return runInTenantTransaction(orgId, async () => {
  if (!input.customerId.trim()) throw new ServiceJobError("Customer chunna zaroori hai.");
  const customer = await findById(customers, orgId, input.customerId);
  if (!customer || customer.status !== "Active") throw new ServiceJobError("Active customer nahi mila.");

  const id = generateId("SVJ");
  const row = await insertRecord(serviceJobs, {
    id,
    orgId,
    customerId: input.customerId,
    productDetails: input.productDetails?.trim() ?? "",
    brand: input.brand?.trim() ?? "",
    siteAddress: input.siteAddress?.trim() ?? "",
    attendantName: input.attendantName?.trim() ?? "",
    attendantPhone: input.attendantPhone?.trim() ?? "",
    status: "Pending",
    createdBy: actorId,
  });

  await logFieldServiceActivity(orgId, "SERVICE", id, "Created", `Service job "${customer.customerName}" ke liye bani.`, actorId);
  return rowToRecord(orgId, row);
  });
}

export async function getServiceJob(id: string): Promise<ServiceJobRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(serviceJobs, orgId, id);
  return row ? rowToRecord(orgId, row) : null;
}

export async function listServiceJobs(doerIdFilter?: string): Promise<ServiceJobRecord[]> {
  const orgId = await getTenantOrgId();
  let rows = await listByOrg(serviceJobs, orgId);
  if (doerIdFilter) {
    const assigned = await getAssignedTaskIds(orgId, "SERVICE", doerIdFilter);
    rows = rows.filter((r) => assigned.has(r.id));
  }
  const batch = await getBatchDetails(orgId, "SERVICE", rows);
  const records = await Promise.all(rows.map((r) => rowToRecord(orgId, r, batch)));
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listServiceJobActivities(id: string) {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(fieldServiceActivities)
    .where(and(eq(fieldServiceActivities.orgId, orgId), eq(fieldServiceActivities.taskType, "SERVICE"), eq(fieldServiceActivities.taskId, id)))
    .orderBy(desc(fieldServiceActivities.createdAt));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    actorId: r.actorId,
    createdAt: r.createdAt.toISOString(),
  }));
}
