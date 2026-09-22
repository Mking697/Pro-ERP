import { and, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { fmsRuns } from "@/db/schema";
import { db } from "@/db/client";
import { listByOrg, insertRecord, findById, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { parseStamp } from "@/lib/timestamp";
import {
  getFmsTemplateStep,
  listFmsTemplates,
  parseNextStepMap,
  parseOutcomeOptions,
  type FmsTatUnit,
  type FmsTemplateStepRecord,
} from "@/lib/fms/templates";
import { computeNextWorkingInstant, computeTatDeadline, computeUserDayEnd } from "@/lib/fms/calendar";
import {
  parseStepDataSourceConfig,
  missingRequiredFields,
  type StepDataSourceConfig,
} from "@/lib/fms/dataSource";
import { resolveExistingFmsData } from "@/lib/fms/dataSourceResolver";
import { parseActionType, parseLedgerMovementActionConfig } from "@/lib/fms/actions";
import { runLedgerMovementAction } from "@/lib/fms/actionRunner";
import { getUserById } from "@/lib/auth/users";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
import {
  parseOutcomeType,
  deriveOutcomeFromQty,
  qtySplitTotal,
  PASS_QTY_KEY,
  FAIL_QTY_KEY,
  SCRAP_QTY_KEY,
} from "@/lib/fms/outcomeType";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `fms_runs` Postgres table —
 * the goal is zero changes at the API routes, `/fms`, the Dashboard and `src/lib/mis.ts`,
 * which all read `.Status`, `.TAT_Deadline`, `.Form_Data`, etc. off this type today.
 *
 * `fms_runs` has a plain `id` (Run_ID) primary key — unlike `fms_templates` above, this
 * satisfies repo.ts's `IdentifiedTable` constraint, so single-row reads/writes go through
 * the generic layer; grouped/filtered reads (by Instance_ID, Assigned_To, ...) are direct
 * Drizzle queries.
 */
export interface FmsRunRecord {
  Run_ID: string;
  Instance_ID: string;
  Template_ID: string;
  Template_Name: string;
  Context_Ref: string;
  Started_By: string;
  Started_At: string;
  Step_No: string;
  Step_Name: string;
  Assigned_To: string;
  Created_At: string;
  TAT_Start: string;
  TAT_Deadline: string;
  Completed_At: string;
  Completed_By: string;
  Outcome: string;
  Status: string;
  Remark: string;
  /** Whatever the completer typed into this step's Data Source form, JSON-encoded. */
  Form_Data: string;
  /** How many physical units this run is handling — blank for a flow that never tracks
   * quantity. See PASS_FAIL_QTY's rework loop in completeFmsStep for why this exists. */
  Quantity: string;
}

type RunRow = InferSelectModel<typeof fmsRuns>;

function runToRecord(row: RunRow): FmsRunRecord {
  return {
    Run_ID: row.id,
    Instance_ID: row.instanceId,
    Template_ID: row.templateId,
    Template_Name: row.templateName,
    Context_Ref: row.contextRef,
    Started_By: row.startedBy,
    Started_At: row.startedAt ? row.startedAt.toISOString() : "",
    Step_No: String(row.stepNo),
    Step_Name: row.stepName,
    Assigned_To: row.assignedTo,
    Created_At: row.createdAt.toISOString(),
    TAT_Start: row.tatStart ? row.tatStart.toISOString() : "",
    TAT_Deadline: row.tatDeadline ? row.tatDeadline.toISOString() : "",
    Completed_At: row.completedAt ? row.completedAt.toISOString() : "",
    Completed_By: row.completedBy,
    Outcome: row.outcome,
    Status: row.status,
    Remark: row.remark,
    Form_Data: row.formData ? JSON.stringify(row.formData) : "",
    Quantity: row.quantity ?? "",
  };
}

/** A step is only "Not Done" while it's still open and past its deadline — a live label,
 * never stored, mirroring isOverdue() in src/lib/mis.ts. */
export function isFmsStepOverdue(run: FmsRunRecord): boolean {
  if (run.Status !== "Pending" || !run.TAT_Deadline) return false;
  const deadline = parseStamp(run.TAT_Deadline);
  return deadline !== null && new Date() > deadline;
}

/**
 * A user can hold only one open TAT at a time. If they already have another Pending step,
 * the new one's clock starts only once the furthest-out existing deadline arrives — pushed
 * forward through the working calendar, never added on top of "now" naively.
 */
export async function queueOpenTatStart(
  orgId: string,
  assignedTo: string,
  naturalStartEpochMs: number
): Promise<number> {
  const openRuns = await db
    .select({ tatDeadline: fmsRuns.tatDeadline })
    .from(fmsRuns)
    .where(
      and(
        eq(fmsRuns.orgId, orgId),
        eq(fmsRuns.assignedTo, assignedTo),
        eq(fmsRuns.status, "Pending")
      )
    );
  const openDeadlines = openRuns
    .map((r) => r.tatDeadline?.getTime())
    .filter((ms): ms is number => typeof ms === "number");

  const snappedNatural = await computeNextWorkingInstant(assignedTo, naturalStartEpochMs);
  if (openDeadlines.length === 0) return snappedNatural;

  const latestOpenDeadline = Math.max(...openDeadlines);
  if (latestOpenDeadline <= snappedNatural) return snappedNatural;
  return computeNextWorkingInstant(assignedTo, latestOpenDeadline);
}

/**
 * A step's TAT is normally just its fixed TAT_Value — this is what makes it computable
 * instead, from a number typed into an *earlier* step of the same running instance. A
 * purchase flow's step 1 types "Lead Days" once; step 2 ("follow up") sources it with
 * offset -1, step 3 ("received") sources it with offset 0 — one number driving two
 * deadlines, rather than the admin guessing a fixed follow-up window that has nothing to
 * do with what this particular vendor actually promised.
 *
 * Falls back to the fixed TAT_Value whenever the source can't be resolved (blank config,
 * the source step hasn't run yet, or its field wasn't a number) — a step must always get
 * *some* deadline, never none.
 */
export async function resolveTatValue(
  orgId: string,
  step: FmsTemplateStepRecord,
  instanceId: string
): Promise<number> {
  const sourceStepNo = Number(step.TAT_Source_Step_No);
  if (!sourceStepNo || !step.TAT_Source_Field_Key) {
    return Number(step.TAT_Value);
  }

  const [sourceRun] = await db
    .select()
    .from(fmsRuns)
    .where(
      and(
        eq(fmsRuns.orgId, orgId),
        eq(fmsRuns.instanceId, instanceId),
        eq(fmsRuns.stepNo, sourceStepNo)
      )
    )
    .limit(1);
  if (!sourceRun) return Number(step.TAT_Value);

  const sourced = Number(sourceRun.formData?.[step.TAT_Source_Field_Key] ?? "");
  if (!Number.isFinite(sourced)) return Number(step.TAT_Value);

  return sourced + (Number(step.TAT_Offset) || 0);
}

interface AppendStepRunInput {
  orgId: string;
  instanceId: string;
  templateId: string;
  templateName: string;
  contextRef: string;
  startedBy: string;
  startedAt: Date;
  stepNo: number;
  stepName: string;
  assignedTo: string;
  tatValue: number;
  tatUnit: FmsTatUnit;
  /** Carried forward from whatever produced this run — blank for an untracked flow. */
  quantity?: number;
}

async function appendStepRun(input: AppendStepRunInput): Promise<FmsRunRecord> {
  const tatStartMs = await queueOpenTatStart(input.orgId, input.assignedTo, Date.now());
  const tatDeadlineMs = await computeTatDeadline(
    input.assignedTo,
    tatStartMs,
    input.tatValue,
    input.tatUnit
  );

  const row = await insertRecord(fmsRuns, {
    id: generateId("RUN"),
    orgId: input.orgId,
    instanceId: input.instanceId,
    templateId: input.templateId,
    templateName: input.templateName,
    contextRef: input.contextRef,
    startedBy: input.startedBy,
    startedAt: input.startedAt,
    stepNo: input.stepNo,
    stepName: input.stepName,
    assignedTo: input.assignedTo,
    createdAt: new Date(),
    tatStart: new Date(tatStartMs),
    tatDeadline: new Date(tatDeadlineMs),
    completedAt: null,
    completedBy: "",
    outcome: "",
    status: "Pending",
    remark: "",
    formData: null,
    quantity: input.quantity !== undefined ? String(input.quantity) : null,
  });

  return runToRecord(row);
}

/**
 * Recomputes a Pending run's TAT_Start/TAT_Deadline against `newAssignedTo`'s own working
 * calendar (shift, lunch/tea, weekly-off/holidays, their own open-TAT queue) — starting
 * fresh from now, using the step's own TAT_Value/TAT_Unit (resolved the same way a brand
 * new run would be, including a step-sourced TAT). Called by Leave's reassignment (see
 * src/lib/leave/reassignment.ts) so a run handed to a buddy — or handed back — gets a
 * deadline computed against *their* calendar, not whoever held the run when it was created.
 * A no-op for a run that has already left Pending (nothing left to recompute).
 */
export async function recomputeRunTat(orgId: string, runId: string, newAssignedTo: string): Promise<void> {
  const run = await findById(fmsRuns, orgId, runId);
  if (!run || run.status !== "Pending") return;

  const step = await getFmsTemplateStep(run.templateId, run.stepNo);
  if (!step) return;

  const tatValue = await resolveTatValue(orgId, step, run.instanceId);
  const tatStartMs = await queueOpenTatStart(orgId, newAssignedTo, Date.now());
  const tatDeadlineMs = await computeTatDeadline(
    newAssignedTo,
    tatStartMs,
    tatValue,
    step.TAT_Unit as FmsTatUnit
  );

  await updateById(fmsRuns, orgId, runId, {
    tatStart: new Date(tatStartMs),
    tatDeadline: new Date(tatDeadlineMs),
  });
}

interface StartFmsInstanceInput {
  templateId: string;
  /** Freeform link back to whatever caused this — e.g. "INWARD_IQC_FMS:INW-K3M9QX7A". */
  contextRef: string;
  /** A user id, or "SYSTEM" when started by an emitted event rather than a person. */
  startedBy: string;
  /** Seeds the first step's Quantity — e.g. a production plan's actual quantity. Omitted
   * for a flow that never tracks quantity. */
  initialQuantity?: number;
}

export async function startFmsInstance(input: StartFmsInstanceInput): Promise<FmsRunRecord> {
  const orgId = await getTenantOrgId();
  const firstStep = await getFmsTemplateStep(input.templateId, 1);
  if (!firstStep) {
    throw new Error("Is template ka pehla step nahi mila.");
  }

  return appendStepRun({
    orgId,
    instanceId: generateId("INS"),
    templateId: input.templateId,
    templateName: firstStep.Template_Name,
    contextRef: input.contextRef,
    startedBy: input.startedBy,
    startedAt: new Date(),
    stepNo: 1,
    stepName: firstStep.Step_Name,
    assignedTo: firstStep.Assigned_To,
    tatValue: Number(firstStep.TAT_Value),
    tatUnit: firstStep.TAT_Unit as FmsTatUnit,
    quantity: input.initialQuantity,
  });
}

interface CompleteFmsStepInput {
  runId: string;
  outcome: string;
  completedBy: string;
  remark?: string;
  /** Values typed into this step's own Data Source form, when it has one. */
  formData?: Record<string, string>;
}

export async function completeFmsStep(
  input: CompleteFmsStepInput
): Promise<{ completed: FmsRunRecord; next: FmsRunRecord[] }> {
  const orgId = await getTenantOrgId();
  const runRow = await findById(fmsRuns, orgId, input.runId);
  if (!runRow) throw new Error("Step nahi mila.");
  const run = runToRecord(runRow);

  if (run.Status !== "Pending") {
    throw new Error("Yeh step pehle se complete ho chuka hai.");
  }
  if (run.Assigned_To !== input.completedBy) {
    throw new Error("Aap sirf apne assigned step complete kar sakte hain.");
  }

  const step = await getFmsTemplateStep(run.Template_ID, Number(run.Step_No));
  if (!step) {
    throw new Error("Is step ki template definition nahi mili — template edit/delete ho chuka hoga.");
  }

  const formValues = input.formData ?? {};
  const dataSource = parseStepDataSourceConfig(step.Data_Source_Config);
  if (dataSource.form) {
    const missing = missingRequiredFields(dataSource.form, formValues);
    if (missing.length > 0) {
      throw new Error(`Ye fields zaroori hain: ${missing.map((f) => f.label).join(", ")}`);
    }
  }

  // PASS_FAIL_QTY has no Outcome dropdown for the completer to pick — whatever the client
  // sent is ignored, and the branch always follows the numbers actually typed in, so a
  // tampered request can't claim "Pass" while reporting a nonzero Fail Qty.
  const outcomeType = parseOutcomeType(step.Outcome_Type);
  let outcome = input.outcome;
  let passQty = 0;
  let failQty = 0;
  let scrapQty = 0;
  if (outcomeType === "PASS_FAIL_QTY") {
    passQty = Number(formValues[PASS_QTY_KEY] || 0);
    failQty = Number(formValues[FAIL_QTY_KEY] || 0);
    scrapQty = Number(formValues[SCRAP_QTY_KEY] || 0);
    if (
      !Number.isFinite(passQty) || passQty < 0 ||
      !Number.isFinite(failQty) || failQty < 0 ||
      !Number.isFinite(scrapQty) || scrapQty < 0
    ) {
      throw new Error("Pass, Fail aur Scrap Qty non-negative number honi chahiye.");
    }

    // Every unit this run holds has to be accounted for somewhere. Skipped when the run
    // never got a Quantity (an untracked flow) — there is nothing to check the total
    // against then.
    if (run.Quantity) {
      const runQty = Number(run.Quantity);
      const total = qtySplitTotal(formValues);
      if (Math.abs(total - runQty) > 1e-6) {
        throw new Error(
          `Pass + Fail + Scrap Qty milakar ${runQty} honi chahiye (is step ki Quantity) — abhi ${total} hai.`
        );
      }
    }

    outcome = deriveOutcomeFromQty(formValues);
  }

  const validOutcomes = parseOutcomeOptions(step.Outcome_Options);
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`Outcome "${outcome}" is step ke liye valid nahi hai.`);
  }

  // An Action needs every field this step's Data Source can offer, not just what a Form
  // asked for — an Existing-FMS pull (e.g. the plan's own SKU/Qty) is just as valid a
  // binding target as something the completer typed. Both halves can be present on the
  // same step at once — a real production step routinely types a Pass/Fail qty while also
  // needing to see the product's SKU pulled from elsewhere.
  let referenceFields: Record<string, string> = {};
  if (dataSource.existing) {
    const rows = await resolveExistingFmsData(dataSource.existing, run.Context_Ref, run.Instance_ID);
    referenceFields = rows[0] ?? {};
  }
  const resolvedFields = { ...referenceFields, ...formValues };

  // Runs before anything is written: the movement it promises is the whole point of this
  // outcome, so a failure here must leave the step Pending, not complete it half-done.
  const actionType = parseActionType(step.Action_Type);
  if (actionType === "LEDGER_MOVEMENT") {
    const actionConfig = parseLedgerMovementActionConfig(step.Action_Config);
    if (outcomeType === "PASS_FAIL_QTY") {
      // The derived `outcome` label is "Fail" whenever any unit failed, even if most of
      // the batch passed — that label is for history/branching, not for gating the
      // write. A configured "Pass" action must still fire for whatever quantity actually
      // passed, partial fail or not; Fail Qty always loops back for rework (nothing to
      // write yet) and Scrap Qty never should, so neither ever triggers an action here.
      if (passQty > 0) {
        await runLedgerMovementAction(actionConfig, "Pass", resolvedFields, run.Run_ID, input.completedBy);
      }
    } else {
      await runLedgerMovementAction(actionConfig, outcome, resolvedFields, run.Run_ID, input.completedBy);
    }
  }

  const now = new Date();
  const deadline = parseStamp(run.TAT_Deadline);
  const isOnTime = !deadline || now <= deadline;
  const status = isOnTime ? "On Time" : "Delay Done";
  const remark = input.remark ?? "";

  const updatedRow = await updateById(fmsRuns, orgId, input.runId, {
    completedAt: now,
    completedBy: input.completedBy,
    outcome,
    status,
    remark,
    formData: formValues,
  });
  if (!updatedRow) throw new Error("Step nahi mila.");
  const completed = runToRecord(updatedRow);

  const nextMap = parseNextStepMap(step.Next_Step_Map);

  /** Appends a run at another step of this same instance, carrying a quantity forward. */
  async function createRun(stepNo: number, quantity: number | undefined): Promise<FmsRunRecord | null> {
    const target = await getFmsTemplateStep(run.Template_ID, stepNo);
    if (!target) return null;
    return appendStepRun({
      orgId,
      instanceId: run.Instance_ID,
      templateId: run.Template_ID,
      templateName: run.Template_Name,
      contextRef: run.Context_Ref,
      startedBy: run.Started_By,
      startedAt: run.Started_At ? new Date(run.Started_At) : new Date(),
      stepNo,
      stepName: target.Step_Name,
      assignedTo: target.Assigned_To,
      tatValue: await resolveTatValue(orgId, target, run.Instance_ID),
      tatUnit: target.TAT_Unit as FmsTatUnit,
      quantity,
    });
  }

  const next: FmsRunRecord[] = [];

  if (outcomeType === "PASS_FAIL_QTY") {
    // Pass Qty moves on to whatever the admin wired "Pass" to — same as any other
    // outcome's branch. Fail Qty never consults Next_Step_Map at all: it always loops
    // back to this same step, reassigned to the same doer, as its own new Pending run —
    // that is the rework the doer sees. It can fail again (looping again, recursively)
    // or resolve via Scrap Qty, which spawns nothing and simply removes those units from
    // the flow — the final step's stock write only ever sees whatever quantity survived
    // every loop, never the original count.
    if (passQty > 0) {
      const target = nextMap["Pass"];
      if (target && target !== "END") {
        const created = await createRun(Number(target), passQty);
        if (created) next.push(created);
      }
    }
    if (failQty > 0) {
      const created = await createRun(Number(run.Step_No), failQty);
      if (created) next.push(created);
    }
  } else {
    const target = nextMap[outcome];
    if (target && target !== "END") {
      const created = await createRun(
        Number(target),
        run.Quantity ? Number(run.Quantity) : undefined
      );
      if (created) next.push(created);
    }
  }

  // Best-effort chaining: a broken or archived downstream template must never undo the
  // step completion that has already saved above. No loop guard — trusted to the admin
  // who wires up triggers, per the confirmed scope of this build.
  try {
    await emitFmsEvent(`FMS:${run.Template_ID}:${run.Step_No}:${outcome}`, run.Context_Ref);
  } catch (error) {
    console.error(`[fms] chained event emit failed for run ${run.Run_ID}:`, error);
  }

  // Best-effort, same as the chaining above: whoever is on this step's own
  // Notify_On_Complete list just wants to *know* the moment it's done — a supervisor who
  // isn't part of the flow at all, independent of whichever assignee the next run above
  // was created for. A send failure (missing/invalid phone, ChatXFlow unconfigured,
  // network) must never undo the completion already saved above — notifyStepComplete
  // never throws (every recipient's own send is individually try/caught inside it) and
  // fires every recipient in parallel via Promise.all, so N slow/broken sends only ever
  // cost as long as the single slowest one, never their sum.
  try {
    await notifyStepComplete(step, completed);
  } catch (error) {
    console.error(`[fms] notifyStepComplete failed for run ${run.Run_ID}:`, error);
  }

  return { completed, next };
}

/** Fires WhatsApp notifications to every user on a step's Notify_On_Complete list — never
 * throws, never awaited by completeFmsStep's own return (see the catch at its call site).
 * A recipient with no phone number on file is skipped silently (not misconfiguration, just
 * nothing to send to); every other failure is console.error'd so a real misconfiguration
 * (e.g. ChatXFlow not set up for this org) stays visible to whoever debugs it later. */
async function notifyStepComplete(
  step: FmsTemplateStepRecord,
  completed: FmsRunRecord
): Promise<void> {
  const userIds = step.Notify_On_Complete;
  if (!userIds || userIds.length === 0) return;

  await Promise.all(
    userIds.map(async (userId) => {
      try {
        const user = await getUserById(userId);
        if (!user || !user.Phone_Number) return;

        const message = `Namaste ${user.Full_Name}, "${completed.Template_Name}" me "${completed.Step_Name}" complete ho gaya (${completed.Outcome}).`;
        const result = await sendWhatsAppMessage(user.Phone_Number, message);
        if (!result.ok) {
          console.error(
            `[fms] notify send failed for run ${completed.Run_ID}, user ${userId}: ${result.error}`
          );
        }
      } catch (error) {
        console.error(`[fms] notify send threw for run ${completed.Run_ID}, user ${userId}:`, error);
      }
    })
  );
}

/**
 * The one generic chaining primitive. Both a completed FMS step (above) and another
 * module's own code (e.g. src/lib/inward.ts after saving an entry) call this the same
 * way — it doesn't know or care which.
 */
export async function emitFmsEvent(
  sourceKey: string,
  contextRef: string,
  initialQuantity?: number
): Promise<void> {
  const allSteps = await listFmsTemplates();
  const matchingFirstSteps = allSteps.filter(
    (s) => Number(s.Step_No) === 1 && s.Trigger_Event === sourceKey && s.Status === "Active"
  );

  for (const step of matchingFirstSteps) {
    try {
      await startFmsInstance({
        templateId: step.Template_ID,
        contextRef,
        startedBy: "SYSTEM",
        initialQuantity,
      });
    } catch (error) {
      console.error(`[fms] emitFmsEvent failed to start template ${step.Template_ID}:`, error);
    }
  }
}

export interface FmsStepContext {
  run: FmsRunRecord;
  step: FmsTemplateStepRecord;
  dataSource: StepDataSourceConfig;
  /** Populated only when dataSource.existing is set — live-pulled, read-only. */
  referenceRows: Record<string, string>[];
}

/**
 * Everything the Complete-step dialog needs before the user submits: the step's own
 * definition, its Data Source shape, and — when it pulls from elsewhere — the actual
 * pulled reference row(s), resolved fresh on every call (never cached; see
 * resolveExistingFmsData's own reasoning).
 */
export async function getFmsStepContext(runId: string): Promise<FmsStepContext | null> {
  const orgId = await getTenantOrgId();
  const runRow = await findById(fmsRuns, orgId, runId);
  if (!runRow) return null;
  const run = runToRecord(runRow);

  const step = await getFmsTemplateStep(run.Template_ID, Number(run.Step_No));
  if (!step) return null;

  const dataSource = parseStepDataSourceConfig(step.Data_Source_Config);
  const referenceRows = dataSource.existing
    ? await resolveExistingFmsData(dataSource.existing, run.Context_Ref, run.Instance_ID)
    : [];

  return { run, step, dataSource, referenceRows };
}

/** Every FMS_RUNS row ever assigned to this user, any status — what MIS scoring (see
 * src/lib/mis.ts's fmsMisCounts) and the score-breakdown table evaluate. */
export async function listFmsRunsForUser(userId: string): Promise<FmsRunRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(fmsRuns)
    .where(and(eq(fmsRuns.orgId, orgId), eq(fmsRuns.assignedTo, userId)));
  return rows.map(runToRecord);
}

export async function listMyPendingFmsSteps(userId: string): Promise<FmsRunRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(fmsRuns)
    .where(
      and(eq(fmsRuns.orgId, orgId), eq(fmsRuns.assignedTo, userId), eq(fmsRuns.status, "Pending"))
    );
  return rows.map(runToRecord);
}

/**
 * Everything the Dashboard should still show a user today: every step still Pending, plus
 * anything they completed today that hasn't rolled past the end of their working day yet —
 * a step finished five minutes ago should not vanish from the screen the instant it's
 * done, only once that working day is actually over. Rolls into FMS History (see
 * src/lib/fms/history.ts) after that, same as it always could.
 *
 * Separate from listMyPendingFmsSteps() on purpose: /fms's own "My Steps" tab keeps its
 * simpler, unconditional Pending-only contract; only the Dashboard gets the lingering
 * behaviour, so this is additive rather than a change to already-relied-on behaviour.
 */
export async function listMyDashboardFmsSteps(userId: string): Promise<FmsRunRecord[]> {
  const mine = await listFmsRunsForUser(userId);
  const pending = mine.filter((r) => r.Status === "Pending");

  const completedToday: FmsRunRecord[] = [];
  for (const run of mine) {
    if (run.Status === "Pending" || !run.Completed_At) continue;
    const completedAt = parseStamp(run.Completed_At);
    if (!completedAt) continue;
    const dayEnd = await computeUserDayEnd(userId, completedAt.getTime());
    // No working windows that day (shouldn't normally happen for a real completion, but
    // guards against a since-changed calendar) — treat it as already rolled into history
    // rather than showing it forever.
    if (dayEnd !== null && Date.now() < dayEnd) completedToday.push(run);
  }

  return [...pending, ...completedToday];
}

export async function listFmsInstanceHistory(instanceId: string): Promise<FmsRunRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(fmsRuns)
    .where(and(eq(fmsRuns.orgId, orgId), eq(fmsRuns.instanceId, instanceId)));
  return rows.map(runToRecord).sort((a, b) => Number(a.Step_No) - Number(b.Step_No));
}

export async function listAllFmsRuns(): Promise<FmsRunRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(fmsRuns, orgId);
  return rows.map(runToRecord);
}

/**
 * Whether any instance is still mid-flow against this exact template version — the guard
 * a template Delete needs. Archiving alone never disturbs an already-running instance (it
 * keeps resolving steps from the archived version, on purpose); actually removing that
 * version's rows would leave a Pending step with no template left to resolve against, so
 * the API route checks this before calling deleteFmsTemplate.
 */
export async function hasPendingFmsRunsForTemplate(templateId: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const [row] = await db
    .select({ id: fmsRuns.id })
    .from(fmsRuns)
    .where(
      and(eq(fmsRuns.orgId, orgId), eq(fmsRuns.templateId, templateId), eq(fmsRuns.status, "Pending"))
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Whether an FMS "Line" is already tracking a production plan — i.e. starting production
 * fired PRODUCTION_STARTED and some Admin-built template picked it up. When one has, that
 * Line's own last step is what writes the FG stock (via its own Ledger Movement Action,
 * using the quantity that actually passed every stage) — src/lib/inventory/plans.ts's
 * completePlan() must not also write one, or the same production would double-count.
 *
 * Lives here (not in plans.ts) now that FMS_RUNS is a real Postgres table this module
 * already owns — plans.ts (an earlier, already-migrated Phase 3 group, otherwise left
 * untouched by this FMS group) previously kept its own local copy of this exact check
 * reading FMS_RUNS through the old Sheets-backed helpers; that copy would have silently
 * gone stale (always returning false) the moment FMS stopped writing to that sheet, so
 * plans.ts's completePlan() now imports this one instead — see that file's own updated
 * comment.
 */
export async function hasFmsLine(planId: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const [row] = await db
    .select({ id: fmsRuns.id })
    .from(fmsRuns)
    .where(and(eq(fmsRuns.orgId, orgId), eq(fmsRuns.contextRef, `PRODUCTION_PLANS:${planId}`)))
    .limit(1);
  return Boolean(row);
}
