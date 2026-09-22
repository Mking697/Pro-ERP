import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { leaveApprovals, leaves } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getUserById } from "@/lib/auth/users";
import { listLeaveApprovalSteps } from "@/lib/leave/approvalSetup";
import { activateLeave } from "@/lib/leave/reassignment";
import { todayIST } from "@/lib/dateUtil";
import { daysBetween, getLeaveQuotas, getUsedDaysThisYear } from "@/lib/leave/quotas";

export const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Other"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export class LeaveError extends Error {}

export interface LeaveApprovalRecord {
  id: string;
  stepNo: number;
  approverId: string;
  approverName: string;
  decision: string;
  remark: string;
  decidedAt: string;
}

export interface LeaveRecord {
  id: string;
  doerId: string;
  doerName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  buddyId: string;
  buddyName: string;
  isEmergency: boolean;
  filedBy: string;
  filedByName: string;
  status: string;
  currentStepNo: number;
  activatedAt: string;
  revertedAt: string;
  createdAt: string;
  approvals: LeaveApprovalRecord[];
}

type LeaveRow = InferSelectModel<typeof leaves>;

async function userName(userId: string): Promise<string> {
  if (!userId) return "";
  const user = await getUserById(userId);
  return user?.Full_Name ?? userId;
}

async function loadApprovals(orgId: string, leaveId: string): Promise<LeaveApprovalRecord[]> {
  const rows = await db
    .select()
    .from(leaveApprovals)
    .where(and(eq(leaveApprovals.orgId, orgId), eq(leaveApprovals.leaveId, leaveId)));
  rows.sort((a, b) => a.stepNo - b.stepNo);

  const result: LeaveApprovalRecord[] = [];
  for (const r of rows) {
    result.push({
      id: r.id,
      stepNo: r.stepNo,
      approverId: r.approverId,
      approverName: await userName(r.approverId),
      decision: r.decision,
      remark: r.remark,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : "",
    });
  }
  return result;
}

async function rowToRecord(row: LeaveRow): Promise<LeaveRecord> {
  const [doerName, buddyName, filedByName, approvals] = await Promise.all([
    userName(row.doerId),
    userName(row.buddyId),
    userName(row.filedBy),
    loadApprovals(row.orgId, row.id),
  ]);
  return {
    id: row.id,
    doerId: row.doerId,
    doerName,
    leaveType: row.leaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: row.reason,
    buddyId: row.buddyId,
    buddyName,
    isEmergency: row.isEmergency,
    filedBy: row.filedBy,
    filedByName,
    status: row.status,
    currentStepNo: row.currentStepNo,
    activatedAt: row.activatedAt ? row.activatedAt.toISOString() : "",
    revertedAt: row.revertedAt ? row.revertedAt.toISOString() : "",
    createdAt: row.createdAt.toISOString(),
    approvals,
  };
}

/** Every step in the org's approval chain, resolved to a real user id for this specific
 * requester — a "Reporting Manager" step is skipped outright if the requester has none
 * set, rather than blocking the leave on a chain nobody configured for them. */
async function resolveApprovers(doerId: string): Promise<string[]> {
  const steps = await listLeaveApprovalSteps();
  const doer = await getUserById(doerId);

  const resolved: string[] = [];
  for (const step of steps) {
    if (step.approverType === "SPECIFIC_USER") {
      if (step.specificUserId) resolved.push(step.specificUserId);
    } else if (doer?.Reporting_Manager_ID) {
      resolved.push(doer.Reporting_Manager_ID);
    }
  }
  return resolved;
}

export interface CreateLeaveInput {
  doerId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  buddyId: string;
  isEmergency: boolean;
  filedBy: string;
}

export async function createLeave(input: CreateLeaveInput): Promise<LeaveRecord> {
  if (input.endDate < input.startDate) {
    throw new LeaveError("End date, start date se pehle nahi ho sakti.");
  }
  if (!input.buddyId) {
    throw new LeaveError("Buddy chunna zaroori hai.");
  }
  if (input.buddyId === input.doerId) {
    throw new LeaveError("Buddy khud doer nahi ho sakta.");
  }

  const orgId = await getTenantOrgId();
  const [doer, buddy] = await Promise.all([getUserById(input.doerId), getUserById(input.buddyId)]);
  if (!doer) throw new LeaveError("Doer nahi mila.");
  if (!buddy || buddy.Status !== "Active") {
    throw new LeaveError("Buddy ek active user hona chahiye.");
  }

  // Quota gate — a hard refusal, not a warning, so every leave that ever exists is by
  // construction within its type's annual quota (a type with no quota row is unlimited).
  const requestedDays = daysBetween(input.startDate, input.endDate);
  const quotas = await getLeaveQuotas();
  const quota = quotas[input.leaveType];
  if (quota) {
    const year = Number(input.startDate.slice(0, 4));
    const used = await getUsedDaysThisYear(input.doerId, input.leaveType, year);
    const remaining = quota - used;
    if (requestedDays > remaining) {
      throw new LeaveError(
        `${input.leaveType} leave ka is saal ka balance ${remaining} din bacha hai — ${requestedDays} din ki request quota se zyada hai.`
      );
    }
  }

  const approverIds = await resolveApprovers(input.doerId);

  const id = generateId("LV");
  await insertRecord(leaves, {
    id,
    orgId,
    doerId: input.doerId,
    leaveType: input.leaveType,
    startDate: input.startDate,
    endDate: input.endDate,
    reason: input.reason,
    buddyId: input.buddyId,
    isEmergency: input.isEmergency,
    filedBy: input.filedBy,
    // No approval chain configured for this org/requester -> nothing to wait on.
    status: approverIds.length === 0 ? "Approved" : "Pending",
    currentStepNo: approverIds.length === 0 ? 0 : 1,
  });

  for (let i = 0; i < approverIds.length; i++) {
    await insertRecord(leaveApprovals, {
      id: generateId("LAP"),
      orgId,
      leaveId: id,
      stepNo: i + 1,
      approverId: approverIds[i],
      decision: "Pending",
    });
  }

  if (approverIds.length === 0) {
    const today = todayIST();
    if (input.startDate <= today && today <= input.endDate) {
      await activateLeave(id);
    }
  }

  const created = await findById(leaves, orgId, id);
  if (!created) throw new LeaveError("Leave ban gayi lekin load nahi ho payi.");
  return rowToRecord(created);
}

async function loadLeave(orgId: string, leaveId: string): Promise<LeaveRow> {
  const found = await findById(leaves, orgId, leaveId);
  if (!found) throw new LeaveError("Leave nahi mili.");
  return found;
}

export async function getLeave(leaveId: string): Promise<LeaveRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(leaves, orgId, leaveId);
  return row ? rowToRecord(row) : null;
}

/** Every leave this user filed for themself, or on someone else's behalf (emergency). */
export async function listMyLeaves(userId: string): Promise<LeaveRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(leaves).where(eq(leaves.orgId, orgId));
  const mine = rows.filter((r) => r.doerId === userId || r.filedBy === userId);
  mine.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return Promise.all(mine.map(rowToRecord));
}

/** Every leave currently waiting on this user's own decision (they are the resolved
 * approver for its current step). */
export async function listPendingApprovalsFor(userId: string): Promise<LeaveRecord[]> {
  const orgId = await getTenantOrgId();
  const [leaveRows, approvalRows] = await Promise.all([
    db.select().from(leaves).where(and(eq(leaves.orgId, orgId), eq(leaves.status, "Pending"))),
    db.select().from(leaveApprovals).where(eq(leaveApprovals.orgId, orgId)),
  ]);

  const pending: LeaveRow[] = [];
  for (const leave of leaveRows) {
    const currentStep = approvalRows.find(
      (a) => a.leaveId === leave.id && a.stepNo === leave.currentStepNo
    );
    if (currentStep && currentStep.approverId === userId && currentStep.decision === "Pending") {
      pending.push(leave);
    }
  }
  pending.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return Promise.all(pending.map(rowToRecord));
}

async function countApprovalSteps(orgId: string, leaveId: string): Promise<number> {
  const rows = await db
    .select({ stepNo: leaveApprovals.stepNo })
    .from(leaveApprovals)
    .where(and(eq(leaveApprovals.orgId, orgId), eq(leaveApprovals.leaveId, leaveId)));
  return rows.length;
}

export async function decideLeaveStep(
  leaveId: string,
  userId: string,
  decision: "Approved" | "Rejected",
  remark: string
): Promise<LeaveRecord> {
  const orgId = await getTenantOrgId();
  const leave = await loadLeave(orgId, leaveId);
  if (leave.status !== "Pending") {
    throw new LeaveError(`Ye leave pehle se "${leave.status}" hai.`);
  }

  const [currentApproval] = await db
    .select()
    .from(leaveApprovals)
    .where(
      and(
        eq(leaveApprovals.orgId, orgId),
        eq(leaveApprovals.leaveId, leaveId),
        eq(leaveApprovals.stepNo, leave.currentStepNo)
      )
    )
    .limit(1);

  if (!currentApproval || currentApproval.approverId !== userId) {
    throw new LeaveError("Is step ka decision lene ka access aapke paas nahi hai.");
  }
  if (currentApproval.decision !== "Pending") {
    throw new LeaveError("Ye step pehle se decide ho chuka hai.");
  }

  await updateById(leaveApprovals, orgId, currentApproval.id, {
    decision,
    remark,
    decidedAt: new Date(),
  });

  if (decision === "Rejected") {
    await updateById(leaves, orgId, leaveId, { status: "Rejected" });
  } else {
    const totalSteps = await countApprovalSteps(orgId, leaveId);
    if (leave.currentStepNo >= totalSteps) {
      await updateById(leaves, orgId, leaveId, { status: "Approved" });
      const today = todayIST();
      if (leave.startDate <= today && today <= leave.endDate) {
        await activateLeave(leaveId);
      }
    } else {
      await updateById(leaves, orgId, leaveId, { currentStepNo: leave.currentStepNo + 1 });
    }
  }

  const updated = await loadLeave(orgId, leaveId);
  return rowToRecord(updated);
}

export async function cancelLeave(leaveId: string, userId: string, isAdmin: boolean): Promise<LeaveRecord> {
  const orgId = await getTenantOrgId();
  const leave = await loadLeave(orgId, leaveId);

  if (leave.doerId !== userId && leave.filedBy !== userId && !isAdmin) {
    throw new LeaveError("Sirf doer, jisne file ki, ya Admin hi cancel kar sakta hai.");
  }
  if (leave.status !== "Pending" && leave.status !== "Approved") {
    throw new LeaveError(`Ye leave "${leave.status}" hai — cancel nahi ho sakti.`);
  }

  if (leave.activatedAt && !leave.revertedAt) {
    const { revertLeave } = await import("@/lib/leave/reassignment");
    await revertLeave(leaveId);
  }

  const updated = await updateById(leaves, orgId, leaveId, { status: "Cancelled" });
  if (!updated) throw new LeaveError("Leave nahi mili.");
  return rowToRecord(updated);
}
