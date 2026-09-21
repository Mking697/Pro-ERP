import { eq } from "drizzle-orm";
import { leaveApprovalSteps } from "@/db/schema";
import { db } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

export type LeaveApproverType = "REPORTING_MANAGER" | "SPECIFIC_USER";

export interface LeaveApprovalStepRecord {
  stepNo: number;
  approverType: LeaveApproverType;
  specificUserId: string;
}

/** The org's own Leave approval chain, ordered — zero, one, or many steps, each either
 * "whoever this requester's Reporting Manager is" (dynamic, resolved per leave) or a
 * fixed person the Admin names (e.g. HR, MD). Empty means leave requests auto-approve —
 * nothing blocks them until an Admin sets this up. */
export async function listLeaveApprovalSteps(): Promise<LeaveApprovalStepRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(leaveApprovalSteps)
    .where(eq(leaveApprovalSteps.orgId, orgId))
    .orderBy(leaveApprovalSteps.stepNo);
  return rows.map((r) => ({
    stepNo: r.stepNo,
    approverType: r.approverType,
    specificUserId: r.specificUserId,
  }));
}

export interface SaveLeaveApprovalStepInput {
  approverType: LeaveApproverType;
  specificUserId?: string;
}

/** Replaces the whole chain — the same "steps are replaced wholesale, not individually
 * patched" semantics an FMS template's own step list already uses. */
export async function saveLeaveApprovalSteps(steps: SaveLeaveApprovalStepInput[]): Promise<void> {
  const orgId = await getTenantOrgId();
  await db.delete(leaveApprovalSteps).where(eq(leaveApprovalSteps.orgId, orgId));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    await db.insert(leaveApprovalSteps).values({
      id: generateId("LAS"),
      orgId,
      stepNo: i + 1,
      approverType: step.approverType,
      specificUserId: step.approverType === "SPECIFIC_USER" ? (step.specificUserId ?? "") : "",
    });
  }
}
