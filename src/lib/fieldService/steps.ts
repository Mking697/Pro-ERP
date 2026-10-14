import { and, eq, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { fieldTaskSteps, fieldTaskAssignments, users } from "@/db/schema";
import { db, runInTenantTransaction, afterTenantCommit } from "@/db/client";
import { assertStepTransition, validateStep, validateCycle } from "./validation";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
import { generateId } from "@/lib/id";
import {
  FIELD_TASK_TYPE_LABEL,
  getFieldTaskCore,
  logFieldServiceActivity,
  updateFieldTaskCore,
  type FieldTaskType,
} from "./core";


/**
 * The Doer's shared 3-step field completion flow, one row per task PER CYCLE (see
 * src/db/schema/fieldService.ts's header comment). Only the Doer currently assigned to
 * the task's ACTIVE cycle may submit a step, and steps must be completed in order
 * (1, 2, 3) — submitting step 3 marks that cycle Completed.
 *
 * Step 1 — site photo (+ optional video) with device lat/long, moves the task In_Progress.
 * Step 2 — Service/Complaint: work-complete evidence file. Site Visit: written visit
 *          notes + an optional site chart/calculation upload.
 * Step 3 — expense amount/notes + optional uploaded bills, moves the task Completed.
 */

export class FieldStepError extends Error {}

export type FieldTaskStepRow = InferSelectModel<typeof fieldTaskSteps>;

export interface FieldStepRecord {
  taskType: FieldTaskType;
  taskId: string;
  cycle: number;
  sitePhotoUrl: string;
  siteVideoUrl: string;
  latitude: number | null;
  longitude: number | null;
  step1At: string;
  evidenceUrl: string;
  notes: string;
  chartUrl: string;
  step2At: string;
  expenseAmount: number | null;
  expenseNotes: string;
  billUrls: string[];
  step3At: string;
}

function rowToRecord(row: FieldTaskStepRow): FieldStepRecord {
  return {
    taskType: row.taskType as FieldTaskType,
    taskId: row.taskId,
    cycle: row.cycle,
    sitePhotoUrl: row.sitePhotoUrl,
    siteVideoUrl: row.siteVideoUrl,
    latitude: row.latitude !== null ? Number(row.latitude) : null,
    longitude: row.longitude !== null ? Number(row.longitude) : null,
    step1At: row.step1At ? row.step1At.toISOString() : "",
    evidenceUrl: row.evidenceUrl,
    notes: row.notes,
    chartUrl: row.chartUrl,
    step2At: row.step2At ? row.step2At.toISOString() : "",
    expenseAmount: row.expenseAmount !== null ? Number(row.expenseAmount) : null,
    expenseNotes: row.expenseNotes,
    billUrls: Array.isArray(row.billUrls) ? (row.billUrls as string[]) : [],
    step3At: row.step3At ? row.step3At.toISOString() : "",
  };
}

async function findStepRow(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  cycle: number
): Promise<FieldTaskStepRow | null> {
  const [row] = await db
    .select()
    .from(fieldTaskSteps)
    .where(
      and(
        eq(fieldTaskSteps.orgId, orgId),
        eq(fieldTaskSteps.taskType, taskType),
        eq(fieldTaskSteps.taskId, taskId),
        eq(fieldTaskSteps.cycle, cycle)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Step progress for one task. `cycle` defaults to the task's current (active) cycle —
 * pass a past cycle to view history from a previous round. */
export async function getStep(
  orgId: string,
  taskType: FieldTaskType,
  taskId: string,
  cycle?: number
): Promise<FieldStepRecord | null> {
  const task = await getFieldTaskCore(orgId, taskType, taskId);
  if (!task) throw new FieldStepError("Task nahi mila.");
  const row = await findStepRow(orgId, taskType, taskId, cycle ?? task.currentCycle);
  return row ? rowToRecord(row) : null;
}

export interface Step1Input { sitePhotoUrl: string; siteVideoUrl?: string; latitude: number; longitude: number; }
export interface Step2Input { evidenceUrl?: string; notes?: string; chartUrl?: string; }
export interface Step3Input { expenseAmount: number; expenseNotes?: string; billUrls?: string[]; }

async function submitStep(orgId: string, taskType: FieldTaskType, taskId: string, doerId: string, step: 1 | 2 | 3, input: Step1Input | Step2Input | Step3Input, expectedCycle: number): Promise<FieldStepRecord> {
  validateCycle(expectedCycle);
  const validated = step === 1 ? validateStep(taskType, 1, input, orgId) : step === 2 ? validateStep(taskType, 2, input, orgId) : validateStep(taskType, 3, input, orgId);
  return runInTenantTransaction(orgId, async () => {
    const task = await getFieldTaskCore(orgId, taskType, taskId);
    if (!task) throw new FieldStepError("Task nahi mila.");
    const [doer] = await db.select().from(users).where(and(eq(users.orgId, orgId), eq(users.id, doerId), eq(users.status, "Active"))).limit(1);
    if (!doer || doer.status !== "Active") throw new FieldStepError("Active assignee required.");
    const [assignment] = await db.select({ id: fieldTaskAssignments.id }).from(fieldTaskAssignments).where(and(eq(fieldTaskAssignments.orgId, orgId), eq(fieldTaskAssignments.taskType, taskType), eq(fieldTaskAssignments.taskId, taskId), eq(fieldTaskAssignments.doerId, doerId), eq(fieldTaskAssignments.cycle, expectedCycle))).limit(1);
    if (!assignment) throw new FieldStepError("Ye task aapko assign nahi hai.");
    const existing = await findStepRow(orgId, taskType, taskId, expectedCycle);
    assertStepTransition(task, existing, step, expectedCycle);
    const now = new Date();
    let saved: FieldTaskStepRow;
    if (step === 1) {
      const v = validated as Step1Input;
      [saved] = await db.insert(fieldTaskSteps).values({id: generateId("FTS"), orgId, taskType, taskId, cycle: expectedCycle, sitePhotoUrl: v.sitePhotoUrl, siteVideoUrl: v.siteVideoUrl ?? "", latitude: String(v.latitude), longitude: String(v.longitude), step1At: now, updatedAt: now}).returning();
      await updateFieldTaskCore(orgId, taskType, taskId, {status: "In_Progress"});
    } else {
      const v2 = validated as Step2Input;
      const v3 = validated as Step3Input;
      const data = step === 2 ? { evidenceUrl: v2.evidenceUrl ?? "", notes: v2.notes ?? "", chartUrl: v2.chartUrl ?? "", step2At: now } : {expenseAmount: String(v3.expenseAmount), expenseNotes: v3.expenseNotes ?? "", billUrls: v3.billUrls ?? [], step3At: now};
      [saved] = await db.update(fieldTaskSteps).set({...data, updatedAt: now}).where(and(eq(fieldTaskSteps.orgId, orgId), eq(fieldTaskSteps.taskType, taskType), eq(fieldTaskSteps.taskId, taskId), eq(fieldTaskSteps.cycle, expectedCycle), eq(fieldTaskSteps.id, existing!.id))).returning();
      if (step === 3) await updateFieldTaskCore(orgId, taskType, taskId, {status: "Completed"});
    }
    if (!saved) throw new FieldStepError("Step save nahi hua.");
    await logFieldServiceActivity(orgId, taskType, taskId, step === 3 ? "Completed" : step === 1 ? "Step1_Done" : "Step2_Done", `${doer.fullName} completed Step ${step} (Round ${expectedCycle}).`, doerId);
    // Capture scoped recipients before leaving the transaction; await every send after COMMIT.
    const staff = await db.select({ phoneNumber: users.phoneNumber, role: users.role }).from(users).where(and(eq(users.orgId, orgId), eq(users.status, "Active")));
    await afterTenantCommit(async () => {
      for (const user of staff) {
        if (!["Admin", "MD", "Delegator"].includes(user.role) || !user.phoneNumber) continue;
        await sendWhatsAppMessage(user.phoneNumber, `${doer.fullName} completed Step ${step} — ${FIELD_TASK_TYPE_LABEL[taskType]} ${taskId} (Round ${expectedCycle}).`).catch(() => undefined);
      }
    });
    return rowToRecord(saved);
  });
}
export function submitStep1(orgId: string, taskType: FieldTaskType, taskId: string, doerId: string, input: Step1Input, cycle: number): Promise<FieldStepRecord> { return submitStep(orgId, taskType, taskId, doerId, 1, input, cycle); }
export function submitStep2(orgId: string, taskType: FieldTaskType, taskId: string, doerId: string, input: Step2Input, cycle: number): Promise<FieldStepRecord> { return submitStep(orgId, taskType, taskId, doerId, 2, input, cycle); }
export function submitStep3(orgId: string, taskType: FieldTaskType, taskId: string, doerId: string, input: Step3Input, cycle: number): Promise<FieldStepRecord> { return submitStep(orgId, taskType, taskId, doerId, 3, input, cycle); }

/** Bounded active-cycle hydration without one task/step read per board row. */
export async function attachSteps(orgId: string, type: FieldTaskType, tasks: {id: string; currentCycle: number}[]): Promise<Map<string, FieldStepRecord>> {
  const result = new Map<string, FieldStepRecord>();
  if (!tasks.length) return result;
  const cycles = new Map(tasks.map(t => [t.id, t.currentCycle]));
  const rows = await db.select().from(fieldTaskSteps).where(and(eq(fieldTaskSteps.orgId, orgId), eq(fieldTaskSteps.taskType, type), inArray(fieldTaskSteps.taskId, tasks.map(t=>t.id))));
  for (const row of rows) if (cycles.get(row.taskId) === row.cycle) result.set(row.taskId, rowToRecord(row));
  return result;
}
export async function getTaskHistory(orgId: string, type: FieldTaskType, taskId: string, doerId?: string) {
  const task = await getFieldTaskCore(orgId, type, taskId);
  if (!task) throw new FieldStepError("Task nahi mila.");
  const assignments = await db.select().from(fieldTaskAssignments).where(and(eq(fieldTaskAssignments.orgId, orgId), eq(fieldTaskAssignments.taskType, type), eq(fieldTaskAssignments.taskId, taskId)));
  const allowed = doerId === undefined ? undefined : new Set(assignments.filter(a=>a.doerId === doerId).map(a=>a.cycle));
  const rows = await db.select().from(fieldTaskSteps).where(and(eq(fieldTaskSteps.orgId, orgId), eq(fieldTaskSteps.taskType, type), eq(fieldTaskSteps.taskId, taskId)));
  return rows.filter(r=>r.step3At && r.cycle <= task.currentCycle && (allowed === undefined || allowed.has(r.cycle))).sort((a,b)=>b.cycle-a.cycle).map(row=>({cycle:row.cycle, step:rowToRecord(row), assignments:assignments.filter(a=>a.cycle === row.cycle).map(a=>({doerId:a.doerId, doerName:a.doerName, fundAmount:a.fundAmount === null ? null : Number(a.fundAmount), fundNotes:a.fundNotes}))}));
}
