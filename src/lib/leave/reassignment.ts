import { and, eq } from "drizzle-orm";
import { fmsRuns, leaveReassignments, leaves, tasks } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { todayIST } from "@/lib/dateUtil";

/**
 * Redirects a Doer's currently-open work to their buddy for a leave that has just
 * started — every one of their Pending Tasks and Pending FMS runs, individually recorded
 * in leave_reassignments so revertLeave() below knows exactly what to hand back later.
 *
 * Deliberately does NOT recompute any FMS step's TAT deadline for the buddy's own working
 * calendar — the deadline stays whatever it already was, the buddy just inherits the same
 * clock. Recomputing it against the buddy's own shift/queue would be more correct but is
 * a materially bigger change; this is the pragmatic v1 boundary.
 */
export async function activateLeave(leaveId: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const leave = await findById(leaves, orgId, leaveId);
  if (!leave) throw new Error(`activateLeave: leave ${leaveId} not found.`);
  if (leave.status !== "Approved" || leave.activatedAt) return; // nothing to do

  const openTasks = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.orgId, orgId), eq(tasks.assignedTo, leave.doerId), eq(tasks.status, "Pending"))
    );
  for (const task of openTasks) {
    await updateById(tasks, orgId, task.id, { assignedTo: leave.buddyId });
    await insertRecord(leaveReassignments, {
      id: generateId("LRA"),
      orgId,
      leaveId,
      entityType: "TASK",
      entityId: task.id,
      originalAssignee: leave.doerId,
      buddyId: leave.buddyId,
    });
  }

  const openRuns = await db
    .select()
    .from(fmsRuns)
    .where(
      and(
        eq(fmsRuns.orgId, orgId),
        eq(fmsRuns.assignedTo, leave.doerId),
        eq(fmsRuns.status, "Pending")
      )
    );
  for (const run of openRuns) {
    await updateById(fmsRuns, orgId, run.id, { assignedTo: leave.buddyId });
    await insertRecord(leaveReassignments, {
      id: generateId("LRA"),
      orgId,
      leaveId,
      entityType: "FMS_RUN",
      entityId: run.id,
      originalAssignee: leave.doerId,
      buddyId: leave.buddyId,
    });
  }

  await updateById(leaves, orgId, leaveId, { activatedAt: new Date() });
}

/**
 * Hands back whatever activateLeave() redirected, once the leave has ended — but only
 * what's still genuinely open with the buddy. Anything the buddy already completed stays
 * completed by them (that's just what actually happened); anything someone else
 * reassigned again in the meantime is left alone rather than clobbered.
 */
export async function revertLeave(leaveId: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const leave = await findById(leaves, orgId, leaveId);
  if (!leave) throw new Error(`revertLeave: leave ${leaveId} not found.`);
  if (!leave.activatedAt || leave.revertedAt) return; // nothing to revert, or already done

  const openReassignments = await db
    .select()
    .from(leaveReassignments)
    .where(and(eq(leaveReassignments.orgId, orgId), eq(leaveReassignments.leaveId, leaveId)));

  for (const r of openReassignments) {
    if (r.revertedAt) continue;

    if (r.entityType === "TASK") {
      const task = await findById(tasks, orgId, r.entityId);
      if (task && task.status === "Pending" && task.assignedTo === r.buddyId) {
        await updateById(tasks, orgId, r.entityId, { assignedTo: r.originalAssignee });
      }
    } else if (r.entityType === "FMS_RUN") {
      const run = await findById(fmsRuns, orgId, r.entityId);
      if (run && run.status === "Pending" && run.assignedTo === r.buddyId) {
        await updateById(fmsRuns, orgId, r.entityId, { assignedTo: r.originalAssignee });
      }
    }

    await updateById(leaveReassignments, orgId, r.id, { revertedAt: new Date() });
  }

  await updateById(leaves, orgId, leaveId, { revertedAt: new Date() });
}

export interface LeaveTransitionResult {
  activated: number;
  reverted: number;
}

/**
 * Runs once a day (alongside the recurring-task cron): starts redirecting an Approved
 * leave's work the moment its start date arrives, and hands it back the day after its end
 * date. A leave approved for a date range already in progress activates immediately from
 * decideLeaveStep() itself — this is what catches every other case (approved in advance,
 * or approved exactly on its own start date after this run already passed).
 */
export async function processLeaveTransitions(): Promise<LeaveTransitionResult> {
  const orgId = await getTenantOrgId();
  const today = todayIST();

  const approvedLeaves = await db
    .select()
    .from(leaves)
    .where(and(eq(leaves.orgId, orgId), eq(leaves.status, "Approved")));

  let activated = 0;
  let reverted = 0;

  for (const leave of approvedLeaves) {
    if (!leave.activatedAt && leave.startDate <= today) {
      await activateLeave(leave.id);
      activated += 1;
    } else if (leave.activatedAt && !leave.revertedAt && leave.endDate < today) {
      await revertLeave(leave.id);
      reverted += 1;
    }
  }

  return { activated, reverted };
}
