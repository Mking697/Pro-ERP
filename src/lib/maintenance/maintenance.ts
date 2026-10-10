import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { maintenanceActivities, maintenanceRequests, fmsRuns } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { findById, insertRecord, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { parseStamp } from "@/lib/timestamp";

/**
 * Maintenance — breakdown and general upkeep requests. See src/db/schema/maintenance.ts's
 * own header comment for the full design (pause/resume mechanics, two-step close).
 *
 * The one real side effect lives here: reportBreakdown() pauses a running Production Line
 * step's TAT by flipping its `fms_runs.status` to "Paused" (so isFmsStepOverdue()/MIS
 * never count it while down), and confirmResolved() — only callable by whoever originally
 * reported it — shifts that step's deadline forward by the real wall-clock duration the
 * breakdown was open, then resumes it to "Pending".
 */

export class MaintenanceError extends Error {}

export type MaintenanceKind =
  | "Breakdown"
  | "Generator_Repair"
  | "Servicing"
  | "Wiring"
  | "Light_Change"
  | "Other";

export type MaintenanceStatus = "Open" | "Fixed_By_Maintenance" | "Resolved" | "Cancelled";

export type MaintenanceActivityKind =
  | "Note"
  | "Reported"
  | "Assigned"
  | "Fixed_By_Maintenance"
  | "Resolved"
  | "Reopened"
  | "Cancelled";

export interface MaintenanceRequestRecord {
  id: string;
  kind: MaintenanceKind;
  productionLineRunId: string;
  productionLineTemplateName: string;
  description: string;
  status: MaintenanceStatus;
  reportedBy: string;
  reportedAt: string;
  assignedTo: string;
  fixedBy: string;
  fixedAt: string;
  fixedRemark: string;
  confirmedBy: string;
  confirmedAt: string;
  confirmedRemark: string;
  pausedTatDeadline: string;
  workingMinutesLost: number | null;
  createdAt: string;
}

export interface MaintenanceActivityRecord {
  id: string;
  requestId: string;
  kind: MaintenanceActivityKind;
  message: string;
  actorId: string;
  createdAt: string;
}

type RequestRow = InferSelectModel<typeof maintenanceRequests>;
type ActivityRow = InferSelectModel<typeof maintenanceActivities>;

function rowToRequest(row: RequestRow): MaintenanceRequestRecord {
  return {
    id: row.id,
    kind: row.kind,
    productionLineRunId: row.productionLineRunId,
    productionLineTemplateName: row.productionLineTemplateName,
    description: row.description,
    status: row.status,
    reportedBy: row.reportedBy,
    reportedAt: row.reportedAt.toISOString(),
    assignedTo: row.assignedTo,
    fixedBy: row.fixedBy,
    fixedAt: row.fixedAt ? row.fixedAt.toISOString() : "",
    fixedRemark: row.fixedRemark,
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : "",
    confirmedRemark: row.confirmedRemark,
    pausedTatDeadline: row.pausedTatDeadline ? row.pausedTatDeadline.toISOString() : "",
    workingMinutesLost: row.workingMinutesLost !== null ? Number(row.workingMinutesLost) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToActivity(row: ActivityRow): MaintenanceActivityRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    kind: row.kind,
    message: row.message,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function logActivity(
  orgId: string,
  requestId: string,
  kind: MaintenanceActivityKind,
  message: string,
  actorId: string
): Promise<void> {
  await insertRecord(maintenanceActivities, {
    id: generateId("MAC"),
    orgId,
    requestId,
    kind,
    message,
    actorId,
  });
}

async function transitionRequest(
  orgId: string,
  existing: RequestRow,
  fields: Partial<typeof maintenanceRequests.$inferInsert>
): Promise<RequestRow> {
  const [updated] = await db.update(maintenanceRequests).set(fields).where(and(
    eq(maintenanceRequests.orgId, orgId), eq(maintenanceRequests.id, existing.id),
    eq(maintenanceRequests.status, existing.status)
  )).returning();
  if (!updated) throw new MaintenanceError("Maintenance request changed — refresh before retrying.");
  return updated;
}

// Exact prior-state predicates also fail closed against writers outside this lock.
async function transitionRun(
  orgId: string,
  run: InferSelectModel<typeof fmsRuns>,
  fields: Partial<typeof fmsRuns.$inferInsert>
): Promise<void> {
  const [updated] = await db.update(fmsRuns).set(fields).where(and(
    eq(fmsRuns.orgId, orgId), eq(fmsRuns.id, run.id),
    eq(fmsRuns.status, run.status), eq(fmsRuns.assignedTo, run.assignedTo)
  )).returning({ id: fmsRuns.id });
  if (!updated) throw new MaintenanceError("Production step changed — refresh before retrying.");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listMaintenanceRequests(): Promise<MaintenanceRequestRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(maintenanceRequests, orgId);
  return rows.map(rowToRequest).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getMaintenanceRequest(id: string): Promise<MaintenanceRequestRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(maintenanceRequests, orgId, id);
  return row ? rowToRequest(row) : null;
}

export async function listMaintenanceActivities(requestId: string): Promise<MaintenanceActivityRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(maintenanceActivities)
    .where(and(eq(maintenanceActivities.orgId, orgId), eq(maintenanceActivities.requestId, requestId)))
    .orderBy(desc(maintenanceActivities.createdAt));
  return rows.map(rowToActivity);
}

/** True while this fms_runs row already has an open (Open or Fixed_By_Maintenance)
 * breakdown against it — a step must never be paused twice at once. */
export async function hasOpenBreakdown(runId: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({ id: maintenanceRequests.id })
    .from(maintenanceRequests)
    .where(
      and(
        eq(maintenanceRequests.orgId, orgId),
        eq(maintenanceRequests.productionLineRunId, runId)
      )
    );
  // Only ever one open request per run at a time in practice, but scan rather than trust
  // that invariant blindly — a stray leftover "Open" row must still be caught.
  const openStatuses: MaintenanceStatus[] = ["Open", "Fixed_By_Maintenance"];
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return false;
  const full = await Promise.all(ids.map((id) => findById(maintenanceRequests, orgId, id)));
  return full.some((r) => r && openStatuses.includes(r.status));
}

// ---------------------------------------------------------------------------
// Writes — Breakdown (pauses a running Production Line step)
// ---------------------------------------------------------------------------

/**
 * Reports a breakdown against a running Production Line step, pausing its TAT clock.
 *
 * Only the step's own assignee may report it — the same "you can only act on what's
 * assigned to you" rule completeFmsStep() already enforces, so a breakdown can't be
 * filed against someone else's running step. The run must be genuinely Pending (not
 * already Paused, not already completed) — paired with hasOpenBreakdown() at the route
 * level so a step can't be paused twice.
 */
export async function reportBreakdown(input: {
  runId: string;
  reportedBy: string;
  description: string;
}): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const run = await findById(fmsRuns, orgId, input.runId);
    if (!run) throw new MaintenanceError("Production Line ka step nahi mila.");
    if (run.assignedTo !== input.reportedBy) {
      throw new MaintenanceError("Aap sirf apne assigned step ke liye breakdown report kar sakte hain.");
    }
    if (run.status !== "Pending") {
      throw new MaintenanceError("Yeh step abhi Pending nahi hai — breakdown report nahi ho sakta.");
    }
    if (await hasOpenBreakdown(input.runId)) {
      throw new MaintenanceError("Is step ke liye pehle se ek breakdown open hai.");
    }

    const id = generateId("MNT");
    const row = await insertRecord(maintenanceRequests, {
      id,
      orgId,
      kind: "Breakdown",
      productionLineRunId: input.runId,
      productionLineTemplateName: run.templateName,
      description: input.description.trim(),
      status: "Open",
      reportedBy: input.reportedBy,
      reportedAt: new Date(),
      pausedTatDeadline: run.tatDeadline,
    });

    await transitionRun(orgId, run, { status: "Paused" });

    await logActivity(
      orgId,
      id,
      "Reported",
      `Breakdown report hua — "${run.stepName}" (${run.templateName}) pause ho gaya.`,
      input.reportedBy
    );

    return rowToRequest(row);
  });
}

/** Maintenance picks up an unassigned request — optional, anyone holding the module
 * grant can still act without this. */
export async function assignMaintenanceRequest(
  requestId: string,
  assignedTo: string,
  actorId: string
): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const existing = await findById(maintenanceRequests, orgId, requestId);
    if (!existing) throw new MaintenanceError("Request nahi mili.");
    if (existing.status !== "Open") {
      throw new MaintenanceError("Yeh request ab Open nahi hai.");
    }

    const updated = await transitionRequest(orgId, existing, { assignedTo });

    await logActivity(orgId, requestId, "Assigned", `Assign hui.`, actorId);
    return rowToRequest(updated);
  });
}

/**
 * Maintenance's own claim that the fix is done — NOT the final word. The step stays
 * Paused; only confirmResolved() (called by whoever reported it) actually resumes it.
 */
export async function markFixedByMaintenance(input: {
  requestId: string;
  fixedBy: string;
  remark?: string;
}): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const existing = await findById(maintenanceRequests, orgId, input.requestId);
    if (!existing) throw new MaintenanceError("Request nahi mili.");
    if (existing.status !== "Open") {
      throw new MaintenanceError("Yeh request Open nahi hai.");
    }

    const updated = await transitionRequest(orgId, existing, {
      status: "Fixed_By_Maintenance",
      fixedBy: input.fixedBy,
      fixedAt: new Date(),
      fixedRemark: input.remark?.trim() ?? "",
    });

    await logActivity(
      orgId,
      input.requestId,
      "Fixed_By_Maintenance",
      `Maintenance ne "kaam ho gaya" mark kiya — reporter ke confirm ka intezaar.`,
      input.fixedBy
    );
    return rowToRequest(updated);
  });
}

/**
 * The confirmation that actually resumes a paused Production Line step.
 *
 * Only `existing.reportedBy` may call this — the person who filed the breakdown is the
 * one who knows whether the line genuinely runs again, not Maintenance's own say-so.
 * Shifts `pausedTatDeadline` forward by the real wall-clock duration the breakdown was
 * open (reportedAt -> now) — the step's remaining working time is preserved exactly as
 * it stood the moment it paused, picking back up as if the pause had never happened.
 */
export async function confirmResolved(input: {
  requestId: string;
  actorId: string;
  remark?: string;
}): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const existing = await findById(maintenanceRequests, orgId, input.requestId);
    if (!existing) throw new MaintenanceError("Request nahi mili.");
    if (existing.status !== "Fixed_By_Maintenance") {
      throw new MaintenanceError(
        "Maintenance ne abhi 'kaam ho gaya' mark nahi kiya — confirm nahi kar sakte."
      );
    }
    if (existing.reportedBy !== input.actorId) {
      throw new MaintenanceError("Sirf jisne breakdown report kiya tha, wahi confirm kar sakta hai.");
    }

    const now = new Date();
    const elapsedMs = Math.max(0, now.getTime() - existing.reportedAt.getTime());
    let resumed = false;

    if (existing.productionLineRunId) {
      const run = await findById(fmsRuns, orgId, existing.productionLineRunId);
      if (run && run.status === "Paused") {
        const basis = existing.pausedTatDeadline ?? run.tatDeadline;
        const newDeadline = basis ? new Date(basis.getTime() + elapsedMs) : null;
        await transitionRun(orgId, run, {
          status: "Pending",
          ...(newDeadline ? { tatDeadline: newDeadline } : {}),
        });
        resumed = true;
      }
    }

    // Reporting figure only — see maintenance_requests.workingMinutesLost's own comment.
    let workingMinutesLost: number | null = null;
    try {
      if (existing.productionLineRunId) {
        const run = await findById(fmsRuns, orgId, existing.productionLineRunId);
        if (run?.assignedTo) {
          const { computeWorkingMinutesBetween } = await import("@/lib/fms/calendar");
          workingMinutesLost = await computeWorkingMinutesBetween(
            run.assignedTo,
            existing.reportedAt.getTime(),
            now.getTime()
          );
        }
      }
    } catch {
      workingMinutesLost = null;
    }

    const updated = await transitionRequest(orgId, existing, {
      status: "Resolved",
      confirmedBy: input.actorId,
      confirmedAt: now,
      confirmedRemark: input.remark?.trim() ?? "",
      ...(workingMinutesLost !== null ? { workingMinutesLost: String(workingMinutesLost) } : {}),
    });

    await logActivity(
      orgId,
      input.requestId,
      "Resolved",
      resumed ? `Confirm hua — Production Line resume ho gayi.` : `Confirm hua — Production step state unchanged.`,
      input.actorId
    );
    return rowToRequest(updated);
  });
}

/** Reopens a request the reporter rejected — Maintenance's fix didn't actually hold.
 * The step stays Paused throughout (it never resumed), so nothing to undo there. */
export async function reopenRequest(input: {
  requestId: string;
  actorId: string;
  remark?: string;
}): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const existing = await findById(maintenanceRequests, orgId, input.requestId);
    if (!existing) throw new MaintenanceError("Request nahi mili.");
    if (existing.status !== "Fixed_By_Maintenance") {
      throw new MaintenanceError("Yeh request abhi reopen nahi ho sakti.");
    }
    if (existing.reportedBy !== input.actorId) {
      throw new MaintenanceError("Sirf jisne breakdown report kiya tha, wahi reopen kar sakta hai.");
    }

    const updated = await transitionRequest(orgId, existing, {
      status: "Open",
      fixedBy: "",
      fixedAt: null,
    });

    await logActivity(
      orgId,
      input.requestId,
      "Reopened",
      `Reopen hui — fix abhi theek nahi tha.${input.remark ? ` ${input.remark.trim()}` : ""}`,
      input.actorId
    );
    return rowToRequest(updated);
  });
}

// ---------------------------------------------------------------------------
// Writes — standalone (non-Breakdown) maintenance log
// ---------------------------------------------------------------------------

const STANDALONE_KINDS: readonly MaintenanceKind[] = [
  "Generator_Repair",
  "Servicing",
  "Wiring",
  "Light_Change",
  "Other",
];

export async function createStandaloneRequest(input: {
  kind: MaintenanceKind;
  description: string;
  reportedBy: string;
}): Promise<MaintenanceRequestRecord> {
  if (!STANDALONE_KINDS.includes(input.kind)) {
    throw new MaintenanceError("Yeh kaam type Production Line se pause nahi hota — standalone hi ho sakta hai.");
  }
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const id = generateId("MNT");
    const row = await insertRecord(maintenanceRequests, {
      id,
      orgId,
      kind: input.kind,
      description: input.description.trim(),
      status: "Open",
      reportedBy: input.reportedBy,
      reportedAt: new Date(),
    });

    await logActivity(orgId, id, "Reported", `"${input.kind}" ke liye request bani.`, input.reportedBy);
    return rowToRequest(row);
  });
}

/** For a standalone request, close it directly — no reporter confirmation needed since
 * nothing was ever paused. For a Breakdown request, use confirmResolved() instead. */
export async function closeStandaloneRequest(input: {
  requestId: string;
  actorId: string;
  remark?: string;
}): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const existing = await findById(maintenanceRequests, orgId, input.requestId);
    if (!existing) throw new MaintenanceError("Request nahi mili.");
    if (existing.kind === "Breakdown") {
      throw new MaintenanceError("Breakdown request confirmResolved() se hi band hoti hai.");
    }
    if (existing.status === "Resolved" || existing.status === "Cancelled") {
      throw new MaintenanceError("Yeh request pehle se band hai.");
    }

    const updated = await transitionRequest(orgId, existing, {
      status: "Resolved",
      fixedBy: input.actorId,
      fixedAt: new Date(),
      confirmedBy: input.actorId,
      confirmedAt: new Date(),
      confirmedRemark: input.remark?.trim() ?? "",
    });

    await logActivity(orgId, input.requestId, "Resolved", `Kaam complete hua.`, input.actorId);
    return rowToRequest(updated);
  });
}

export async function cancelRequest(requestId: string, actorId: string): Promise<MaintenanceRequestRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const existing = await findById(maintenanceRequests, orgId, requestId);
    if (!existing) throw new MaintenanceError("Request nahi mili.");
    if (existing.status === "Resolved" || existing.status === "Cancelled") {
      throw new MaintenanceError("Yeh request pehle se band hai.");
    }

    // A cancelled Breakdown must resume the paused step — otherwise cancelling would
    // leave a Production Line stuck Paused forever with nothing left to confirm it.
    if (existing.kind === "Breakdown" && existing.productionLineRunId) {
      const run = await findById(fmsRuns, orgId, existing.productionLineRunId);
      if (run && run.status === "Paused") {
        await transitionRun(orgId, run, { status: "Pending" });
      }
    }

    const updated = await transitionRequest(orgId, existing, { status: "Cancelled" });

    await logActivity(orgId, requestId, "Cancelled", `Cancel hui.`, actorId);
    return rowToRequest(updated);
  });
}

// Parsed the same lenient way engine.ts reads timestamps.
export function isBreakdownOpen(req: MaintenanceRequestRecord): boolean {
  return (
    (req.status === "Open" || req.status === "Fixed_By_Maintenance") &&
    req.kind === "Breakdown"
  );
}

export { parseStamp };
