import { and, eq, inArray } from "drizzle-orm";
import { customers } from "@/db/schema";
import { db } from "@/db/client";
import { attachAssignments } from "./assignments";
import { attachSteps } from "./steps";
import type { FieldTaskType } from "./core";
export async function getBatchDetails(orgId: string, type: FieldTaskType, tasks: {id: string; currentCycle: number; customerId: string}[]) {
  const customerIds = [...new Set(tasks.map(t => t.customerId))];
  const rows = customerIds.length ? await db.select({id:customers.id, customerName:customers.customerName}).from(customers).where(and(eq(customers.orgId,orgId),inArray(customers.id,customerIds))) : [];
  const assignments = await attachAssignments(orgId, type, tasks);
  const steps = await attachSteps(orgId, type, tasks);
  return {customers: new Map(rows.map(r=>[r.id,r])), assignments, steps};
}
export type BatchDetails = Awaited<ReturnType<typeof getBatchDetails>>;
