import { and, eq, inArray } from "drizzle-orm";
import { fieldTaskAssignments, users } from "@/db/schema";
import { db, runInTenantTransaction, afterTenantCommit } from "@/db/client";
import { validateAssignment, FieldValidationError, validateCycle } from "./validation";
import { insertRecord } from "@/db/repo";
import { generateId } from "@/lib/id";

import { sendWhatsAppMessage } from "@/lib/chatxflow";
import {
  FIELD_TASK_TYPE_LABEL,
  getFieldTaskCore,
  getFieldTaskCores,
  logFieldServiceActivity,
  updateFieldTaskCore,
  type FieldTaskType,
} from "./core";

/**
 * Doer assignment — one row per Doer assigned to a task IN A GIVEN CYCLE (a task can
 * have several Doers at once; reopening a Completed task starts a fresh cycle with a
 * fresh set of rows, the previous cycle's rows stay as permanent history). Mirrors the
 * reference app's own TaskAssignment table (see src/db/schema/fieldService.ts's header
 * comment), rebuilt against Drizzle + org_id tenant scoping, and notifying over the
 * existing WhatsApp (ChatXFlow) channel instead of a separate push provider.
 */

export interface FieldAssignmentInfo {
  doerId: string;
  doerName: string;
  fundAmount: number | null;
  fundNotes: string;
}

function toInfo(row: { doerId: string; doerName: string; fundAmount: string | null; fundNotes: string }): FieldAssignmentInfo {
  return {
    doerId: row.doerId,
    doerName: row.doerName,
    fundAmount: row.fundAmount !== null ? Number(row.fundAmount) : null,
    fundNotes: row.fundNotes,
  };
}

/** Task ids currently assigned to this Doer IN THEIR ACTIVE CYCLE — for "my tasks". */
export async function getAssignedTaskIds(
  orgId: string,
  taskType: FieldTaskType,
  doerId: string
): Promise<Set<string>> {
  const rows = await db
    .select({ taskId: fieldTaskAssignments.taskId, cycle: fieldTaskAssignments.cycle })
    .from(fieldTaskAssignments)
    .where(
      and(
        eq(fieldTaskAssignments.orgId, orgId),
        eq(fieldTaskAssignments.taskType, taskType),
        eq(fieldTaskAssignments.doerId, doerId)
      )
    );
  if (rows.length === 0) return new Set();

  const result = new Set<string>();
  const tasks = await getFieldTaskCores(orgId, taskType, rows.map(r=>r.taskId));
  for (const row of rows) {
    const task = tasks.get(row.taskId);
    if (task && task.currentCycle === row.cycle) result.add(row.taskId);
  }
  return result;
}

/** Attaches the active-cycle assignments for a batch of tasks that already know their
 * own currentCycle. */
export async function attachAssignments(
  orgId: string,
  taskType: FieldTaskType,
  tasks: { id: string; currentCycle: number }[]
): Promise<Map<string, FieldAssignmentInfo[]>> {
  const result = new Map<string, FieldAssignmentInfo[]>();
  if (tasks.length === 0) return result;

  const taskIds = tasks.map((t) => t.id);
  const rows = await db
    .select()
    .from(fieldTaskAssignments)
    .where(
      and(
        eq(fieldTaskAssignments.orgId, orgId),
        eq(fieldTaskAssignments.taskType, taskType),
        inArray(fieldTaskAssignments.taskId, taskIds)
      )
    );

  const cycleByTaskId = new Map(tasks.map((t) => [t.id, t.currentCycle]));
  for (const row of rows) {
    if (row.cycle !== cycleByTaskId.get(row.taskId)) continue; // history, not the active cycle
    const list = result.get(row.taskId) ?? [];
    list.push(toInfo(row));
    result.set(row.taskId, list);
  }
  return result;
}

export async function isTaskAssignedToDoer(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  doerId: string
): Promise<boolean> {
  const task = await getFieldTaskCore(orgId, taskType, taskId);
  if (!task) return false;
  const [row] = await db
    .select({ id: fieldTaskAssignments.id })
    .from(fieldTaskAssignments)
    .where(
      and(
        eq(fieldTaskAssignments.orgId, orgId),
        eq(fieldTaskAssignments.taskType, taskType),
        eq(fieldTaskAssignments.taskId, taskId),
        eq(fieldTaskAssignments.doerId, doerId),
        eq(fieldTaskAssignments.cycle, task.currentCycle)
      )
    )
    .limit(1);
  return Boolean(row);
}

/** Same check, but for a specific historical cycle — lets a Doer view their own past
 * round's step history without still being assigned in the current cycle. */
export async function isTaskAssignedToDoerInCycle(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  doerId: string,
  cycle: number
): Promise<boolean> {
  const [row] = await db
    .select({ id: fieldTaskAssignments.id })
    .from(fieldTaskAssignments)
    .where(
      and(
        eq(fieldTaskAssignments.orgId, orgId),
        eq(fieldTaskAssignments.taskType, taskType),
        eq(fieldTaskAssignments.taskId, taskId),
        eq(fieldTaskAssignments.doerId, doerId),
        eq(fieldTaskAssignments.cycle, cycle)
      )
    )
    .limit(1);
  return Boolean(row);
}

export class FieldAssignmentError extends Error {}

/**
 * Adds (or updates the fund on) one or more Doers for a task, in its CURRENT cycle.
 * Additive — a Doer already assigned this cycle but not in `doerIds` is left untouched;
 * use unassignDoer() to remove one.
 *
 * If the task is currently Completed, this REOPENS it: currentCycle bumps, status
 * resets to Assigned, and the given Doers are assigned fresh in the new cycle — the
 * previous cycle's rows are left exactly as they are, as permanent history.
 */
export async function assignDoers(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  doerIds: string[],
  fundAmount: number | null,
  fundNotes: string,
  actorId: string,
  expectedCycle: number
): Promise<void> {
  validateAssignment({ doerIds, fundAmount, fundNotes }, orgId);
  validateCycle(expectedCycle);
  return runInTenantTransaction(orgId, async () => {
  const task = await getFieldTaskCore(orgId, taskType, taskId);
  if (!task) throw new FieldAssignmentError("Task nahi mila.");

  if (validateCycle(expectedCycle) !== task.currentCycle) throw new FieldAssignmentError("Task cycle changed.");
  const activeUsers = await db.select().from(users).where(and(eq(users.orgId, orgId), inArray(users.id, doerIds), eq(users.status, "Active")));
  if (activeUsers.length !== doerIds.length || doerIds.some((id) => !activeUsers.some((u) => u.id === id && u.status === "Active"))) throw new FieldAssignmentError("All assignees must be active users of this organization.");
  let cycle = task.currentCycle;
  const isReopen = task.status === "Completed";

  if (isReopen) {
    cycle = validateCycle(task.currentCycle + 1);
    await updateFieldTaskCore(orgId, taskType, taskId, { status: "Assigned", currentCycle: cycle });
  } else if (task.status === "Pending") {
    await updateFieldTaskCore(orgId, taskType, taskId, { status: "Assigned" });
  }

  const doerNames = new Map<string, string>();
  const doerPhones = new Map<string, string>();
  for (const user of activeUsers) {
    doerNames.set(user.id, user.fullName);
    doerPhones.set(user.id, user.phoneNumber);
  }

  for (const doerId of doerIds) {
    const existing = await db
      .select({ id: fieldTaskAssignments.id })
      .from(fieldTaskAssignments)
      .where(
        and(
          eq(fieldTaskAssignments.orgId, orgId),
          eq(fieldTaskAssignments.taskType, taskType),
          eq(fieldTaskAssignments.taskId, taskId),
          eq(fieldTaskAssignments.doerId, doerId),
          eq(fieldTaskAssignments.cycle, cycle)
        )
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(fieldTaskAssignments)
        .set({
          ...(fundAmount !== null ? { fundAmount: String(fundAmount) } : {}),
          ...(fundNotes ? { fundNotes } : {}),
        })
        .where(and(eq(fieldTaskAssignments.orgId, orgId), eq(fieldTaskAssignments.taskType, taskType), eq(fieldTaskAssignments.taskId, taskId), eq(fieldTaskAssignments.cycle, cycle), eq(fieldTaskAssignments.id, existing[0].id)));
    } else {
      await insertRecord(fieldTaskAssignments, {
        id: generateId("FTA"),
        orgId,
        taskType,
        taskId,
        doerId,
        doerName: doerNames.get(doerId) ?? "",
        cycle,
        fundAmount: fundAmount !== null ? String(fundAmount) : null,
        fundNotes,
      });
    }
  }

  const label = FIELD_TASK_TYPE_LABEL[taskType];
  await logFieldServiceActivity(
    orgId,
    taskType,
    taskId,
    "Assigned",
    isReopen
      ? `${label} reopen hui — naye round (Cycle ${cycle}) ke liye Doer assign hue.`
      : `${label} Doer(s) ko assign hui.`,
    actorId
  );

  await afterTenantCommit(async () => {
  for (const doerId of doerIds) {
    const phone = doerPhones.get(doerId);
    if (!phone) continue;
    const message = isReopen
      ? `Aapko ek ${label} dobara assign hui hai (Round ${cycle}).`
      : `Aapko ek nayi ${label} assign hui hai.`;
    await sendWhatsAppMessage(phone, message).catch(() => undefined);
  }
  });
  });
}

/** Unassigns a Doer from a task's CURRENT cycle (history is never modified). */
export async function unassignDoer(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  doerId: string,
  actorId: string,
  expectedCycle: number
): Promise<void> {
  validateCycle(expectedCycle);
  if (!doerId || typeof doerId !== "string") throw new FieldValidationError("Invalid doer.");
  return runInTenantTransaction(orgId, async () => {
  const task = await getFieldTaskCore(orgId, taskType, taskId);
  if (!task) throw new FieldAssignmentError("Task nahi mila.");
  if (task.status === "Completed" || (validateCycle(expectedCycle) !== task.currentCycle)) throw new FieldAssignmentError("Task cycle is no longer active.");

  await db
    .delete(fieldTaskAssignments)
    .where(
      and(
        eq(fieldTaskAssignments.orgId, orgId),
        eq(fieldTaskAssignments.taskType, taskType),
        eq(fieldTaskAssignments.taskId, taskId),
        eq(fieldTaskAssignments.doerId, doerId),
        eq(fieldTaskAssignments.cycle, task.currentCycle)
      )
    );

  const remaining = await db.select({ id: fieldTaskAssignments.id }).from(fieldTaskAssignments).where(and(eq(fieldTaskAssignments.orgId, orgId), eq(fieldTaskAssignments.taskType, taskType), eq(fieldTaskAssignments.taskId, taskId), eq(fieldTaskAssignments.cycle, task.currentCycle)));
  if (!remaining.length && task.status === "Assigned") await updateFieldTaskCore(orgId, taskType, taskId, { status: "Pending" });
  await logFieldServiceActivity(orgId, taskType, taskId, "Unassigned", "Ek Doer ko unassign kiya gaya.", actorId);
  });
}

export interface DoerOccupancyEntry {
  taskType: FieldTaskType;
  taskId: string;
  label: string;
  status: string;
}

/** For a set of Doers, which non-Completed tasks (across all 3 task types) each one is
 * currently assigned to IN THE ACTIVE CYCLE — "Free" vs "Occupied on ..." in a picker. */
export async function getDoerOccupancy(
  orgId: string,
  doerIds: string[]
): Promise<Map<string, DoerOccupancyEntry[]>> {
  const result = new Map<string, DoerOccupancyEntry[]>();
  if (doerIds.length === 0) return result;

  const rows = await db
    .select()
    .from(fieldTaskAssignments)
    .where(and(eq(fieldTaskAssignments.orgId, orgId), inArray(fieldTaskAssignments.doerId, doerIds)));
  if (rows.length === 0) return result;

  const taskMaps = new Map<FieldTaskType, Map<string, Awaited<ReturnType<typeof getFieldTaskCore>>>>();
  for (const type of ["SERVICE", "COMPLAINT", "SITE_VISIT"] as const) taskMaps.set(type, await getFieldTaskCores(orgId, type, rows.filter(r=>r.taskType === type).map(r=>r.taskId)));
  for (const row of rows) {
    const task = taskMaps.get(row.taskType as FieldTaskType)?.get(row.taskId);
    if (!task || task.status === "Completed" || task.currentCycle !== row.cycle) continue;
    const list = result.get(row.doerId) ?? [];
    list.push({
      taskType: row.taskType as FieldTaskType,
      taskId: row.taskId,
      label: `${FIELD_TASK_TYPE_LABEL[row.taskType as FieldTaskType]} · ${row.taskId}`,
      status: task.status,
    });
    result.set(row.doerId, list);
  }
  return result;
}
