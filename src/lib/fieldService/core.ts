import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { complaints, serviceJobs, siteVisits, fieldServiceActivities } from "@/db/schema";
import { insertRecord } from "@/db/repo";
import { generateId } from "@/lib/id";
import { updateById, findById } from "@/db/repo";

/**
 * Shared, type-agnostic plumbing for the three Field Service task tables
 * (service_jobs/complaints/site_visits) — mirrors this codebase's own precedent
 * (src/lib/orders/orders.ts <-> src/lib/pdi/pdi.ts) for one table driving several
 * dependent flows, except here all three tables are genuinely interchangeable for the
 * Doer-assignment/step-completion mechanics in src/lib/fieldService/{assignments,steps}.ts.
 */

export type FieldTaskType = "SERVICE" | "COMPLAINT" | "SITE_VISIT";

export const FIELD_TASK_TYPE_LABEL: Record<FieldTaskType, string> = {
  SERVICE: "Service Job",
  COMPLAINT: "Complaint",
  SITE_VISIT: "Site Visit",
};

export interface FieldTaskCoreRow {
  id: string;
  status: string;
  currentCycle: number;
  customerId: string;
}

export function tableFor(taskType: FieldTaskType) {
  if (taskType === "SERVICE") return serviceJobs;
  if (taskType === "SITE_VISIT") return siteVisits;
  return complaints;
}

export async function getFieldTaskCore(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string
): Promise<FieldTaskCoreRow | null> {
  const table = tableFor(taskType);
  const row = await findById(table, orgId, taskId);
  if (!row) return null;
  return { id: row.id, status: row.status, currentCycle: row.currentCycle, customerId: row.customerId };
}

export async function updateFieldTaskCore(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  patch: { status?: string; currentCycle?: number; updatedAt?: Date }
): Promise<void> {
  const table = tableFor(taskType);
  await updateById(table, orgId, taskId, { ...patch, updatedAt: patch.updatedAt ?? new Date() } as never);
}

export type FieldServiceActivityKind =
  | "Note"
  | "Created"
  | "Assigned"
  | "Unassigned"
  | "Step1_Done"
  | "Step2_Done"
  | "Step3_Done"
  | "Completed"
  | "Reopened";

export async function logFieldServiceActivity(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  kind: FieldServiceActivityKind,
  message: string,
  actorId = ""
): Promise<void> {
  await insertRecord(fieldServiceActivities, {
    id: generateId("FSA"),
    orgId,
    taskType,
    taskId,
    kind,
    message,
    actorId,
  });
}

export async function getFieldTaskCores(orgId: string, type: FieldTaskType, ids: string[]): Promise<Map<string, FieldTaskCoreRow>> {
  if (!ids.length) return new Map();
  const table = tableFor(type);
  const rows = await db.select({id:table.id, status:table.status, currentCycle:table.currentCycle, customerId:table.customerId}).from(table).where(and(eq(table.orgId,orgId),inArray(table.id,[...new Set(ids)])));
  return new Map(rows.map(r=>[r.id,r]));
}
