import { and, eq } from "drizzle-orm";
import { fmsRuns, leaveReassignments, leaves, tasks } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { findById, insertRecord, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { todayIST } from "@/lib/dateUtil";

/**
 * Redirects a Doer's currently-open work to their buddy for a leave that has just
 * started — every one of their Pending Tasks and Pending FMS runs, individually recorded
 * in leave_reassignments so revertLeave() below knows exactly what to hand back later.
 *
 * Every reassignment write and its audit insert, across every entity this leave touches,
 * runs inside one `runInTenantTransaction` — so a failure partway through (e.g. the
 * audit insert for the Nth entity) rolls back everything this call did, including the
 * earlier entities' own reassignment+audit pairs and the final `activatedAt` stamp, and
 * never leaves a reassignment that happened but was never logged. A plain retry of the
 * whole call is safe: nothing partial is left behind to retry around.
 *
 * An FMS run's TAT_Start/TAT_Deadline is recomputed against the buddy's own working
 * calendar (shift, lunch/tea, weekly-off/holidays, their own open-TAT queue) via
 * `recomputeRunTat()` — a fresh full TAT window starting now, not the original doer's
 * already-computed deadline inherited as-is. Dynamic import to break the same
 * leave<->fms circular-import shape this codebase already avoids elsewhere (e.g.
 * plans.ts <-> fms/engine.ts).
 */
export async function activateLeave(leaveId: string): Promise<void> {
  const orgId = await getTenantOrgId();
  await runInTenantTransaction(orgId, async () => {
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
    const { recomputeRunTat } = await import("@/lib/fms/engine");
    for (const run of openRuns) {
      await updateById(fmsRuns, orgId, run.id, { assignedTo: leave.buddyId });
      await recomputeRunTat(orgId, run.id, leave.buddyId);
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
  });
}

/**
 * Resolves who should actually hold a *newly created* piece of work for `userId` right
 * now — their buddy, if `userId` currently has a leave that's activated and not yet
 * reverted (i.e. is genuinely mid-leave this instant), otherwise `userId` unchanged.
 *
 * `activateLeave()` above only ever redirects work that already existed at the moment
 * the leave activated. Anything created DURING the leave (a cron-generated recurring
 * Task occurrence, for instance) never went through that redirect and would otherwise
 * land on the absent original doer until the next leave-transition run reassigns it —
 * callers that create new Doer-owned work (see src/lib/recurringGenerator.ts) call this
 * first so it's born already on the correct current holder.
 */
async function findActiveLeave(orgId: string, userId: string) {
  if (!userId) return null;
  const candidates = await db
    .select()
    .from(leaves)
    .where(and(eq(leaves.orgId, orgId), eq(leaves.doerId, userId)));
  return candidates.find((l) => l.activatedAt && !l.revertedAt && l.buddyId) ?? null;
}

export async function resolveActiveAssignee(orgId: string, userId: string): Promise<string> {
  const active = await findActiveLeave(orgId, userId);
  return active ? active.buddyId : userId;
}

export interface ActiveAssigneeResolution {
  /** Who should actually hold the new work right now — the buddy, or `userId` unchanged. */
  assignedTo: string;
  /** The leave this redirect is accountable to, or "" when nobody is on leave — callers
   * use this to decide whether a leave_reassignments audit row is needed at all. */
  leaveId: string;
}

/**
 * Same resolution as resolveActiveAssignee(), but also returns the leave id so the caller
 * can record a leave_reassignments audit row for a *newly created* Task/FMS run — in the
 * SAME transaction as the entity's own insert — so revertLeave() can find and hand it back
 * later exactly like it does for work that existed when the leave activated. Callers own
 * their own `runInTenantTransaction` scope; this function issues only reads.
 */
export async function resolveActiveAssigneeWithAudit(
  orgId: string,
  userId: string
): Promise<ActiveAssigneeResolution> {
  const active = await findActiveLeave(orgId, userId);
  return active ? { assignedTo: active.buddyId, leaveId: active.id } : { assignedTo: userId, leaveId: "" };
}

/**
 * Hands back whatever activateLeave() redirected, once the leave has ended — but only
 * what's still genuinely open with the buddy. Anything the buddy already completed stays
 * completed by them (that's just what actually happened); anything someone else
 * reassigned again in the meantime is left alone rather than clobbered.
 */
export async function revertLeave(leaveId: string): Promise<void> {
  const orgId = await getTenantOrgId();
  await runInTenantTransaction(orgId, async () => {
    const leave = await findById(leaves, orgId, leaveId);
    if (!leave) throw new Error(`revertLeave: leave ${leaveId} not found.`);
    if (!leave.activatedAt || leave.revertedAt) return; // nothing to revert, or already done

    const openReassignments = await db
      .select()
      .from(leaveReassignments)
      .where(and(eq(leaveReassignments.orgId, orgId), eq(leaveReassignments.leaveId, leaveId)));

    const { recomputeRunTat } = await import("@/lib/fms/engine");
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
          await recomputeRunTat(orgId, r.entityId, r.originalAssignee);
        }
      }

      await updateById(leaveReassignments, orgId, r.id, { revertedAt: new Date() });
    }

    await updateById(leaves, orgId, leaveId, { revertedAt: new Date() });
  });
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
