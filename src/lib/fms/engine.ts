import { appendModuleRow, getModuleRows, updateModuleCells, recordToRow } from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { formatStamp, nowStamp, parseStamp } from "@/lib/timestamp";
import {
  getFmsTemplateStep,
  listFmsTemplates,
  parseNextStepMap,
  parseOutcomeOptions,
  type FmsTatUnit,
  type FmsTemplateStepRecord,
} from "@/lib/fms/templates";
import { computeNextWorkingInstant, computeTatDeadline } from "@/lib/fms/calendar";
import {
  parseStepDataSourceConfig,
  missingRequiredFields,
  type StepDataSourceConfig,
} from "@/lib/fms/dataSource";
import { resolveExistingFmsData } from "@/lib/fms/dataSourceResolver";
import { parseActionType, parseLedgerMovementActionConfig } from "@/lib/fms/actions";
import { runLedgerMovementAction } from "@/lib/fms/actionRunner";
import { parseOutcomeType, deriveOutcomeFromQty, PASS_QTY_KEY, FAIL_QTY_KEY } from "@/lib/fms/outcomeType";

const MODULE_KEY = "FMS_RUNS";

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
}

function runToRow(run: FmsRunRecord): string[] {
  return recordToRow(MODULE_KEY, run);
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
async function queueOpenTatStart(assignedTo: string, naturalStartEpochMs: number): Promise<number> {
  const runs = await getModuleRows<FmsRunRecord>(MODULE_KEY);
  const openDeadlines = runs
    .filter((r) => r.Assigned_To === assignedTo && r.Status === "Pending")
    .map((r) => parseStamp(r.TAT_Deadline)?.getTime())
    .filter((ms): ms is number => typeof ms === "number");

  const snappedNatural = await computeNextWorkingInstant(assignedTo, naturalStartEpochMs);
  if (openDeadlines.length === 0) return snappedNatural;

  const latestOpenDeadline = Math.max(...openDeadlines);
  if (latestOpenDeadline <= snappedNatural) return snappedNatural;
  return computeNextWorkingInstant(assignedTo, latestOpenDeadline);
}

interface AppendStepRunInput {
  instanceId: string;
  templateId: string;
  templateName: string;
  contextRef: string;
  startedBy: string;
  startedAt: string;
  stepNo: number;
  stepName: string;
  assignedTo: string;
  tatValue: number;
  tatUnit: FmsTatUnit;
}

async function appendStepRun(input: AppendStepRunInput): Promise<FmsRunRecord> {
  const tatStartMs = await queueOpenTatStart(input.assignedTo, Date.now());
  const tatDeadlineMs = await computeTatDeadline(
    input.assignedTo,
    tatStartMs,
    input.tatValue,
    input.tatUnit
  );

  const run: FmsRunRecord = {
    Run_ID: generateId("RUN"),
    Instance_ID: input.instanceId,
    Template_ID: input.templateId,
    Template_Name: input.templateName,
    Context_Ref: input.contextRef,
    Started_By: input.startedBy,
    Started_At: input.startedAt,
    Step_No: String(input.stepNo),
    Step_Name: input.stepName,
    Assigned_To: input.assignedTo,
    Created_At: nowStamp(),
    TAT_Start: formatStamp(new Date(tatStartMs)),
    TAT_Deadline: formatStamp(new Date(tatDeadlineMs)),
    Completed_At: "",
    Completed_By: "",
    Outcome: "",
    Status: "Pending",
    Remark: "",
    Form_Data: "",
  };

  await appendModuleRow(MODULE_KEY, runToRow(run));
  return run;
}

interface StartFmsInstanceInput {
  templateId: string;
  /** Freeform link back to whatever caused this — e.g. "INWARD_IQC_FMS:INW-K3M9QX7A". */
  contextRef: string;
  /** A user id, or "SYSTEM" when started by an emitted event rather than a person. */
  startedBy: string;
}

export async function startFmsInstance(input: StartFmsInstanceInput): Promise<FmsRunRecord> {
  const firstStep = await getFmsTemplateStep(input.templateId, 1);
  if (!firstStep) {
    throw new Error("Is template ka pehla step nahi mila.");
  }

  return appendStepRun({
    instanceId: generateId("INS"),
    templateId: input.templateId,
    templateName: firstStep.Template_Name,
    contextRef: input.contextRef,
    startedBy: input.startedBy,
    startedAt: nowStamp(),
    stepNo: 1,
    stepName: firstStep.Step_Name,
    assignedTo: firstStep.Assigned_To,
    tatValue: Number(firstStep.TAT_Value),
    tatUnit: firstStep.TAT_Unit as FmsTatUnit,
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
): Promise<{ completed: FmsRunRecord; next: FmsRunRecord | null }> {
  const runs = await getModuleRows<FmsRunRecord>(MODULE_KEY);
  const index = runs.findIndex((r) => r.Run_ID === input.runId);
  if (index === -1) throw new Error("Step nahi mila.");

  const run = runs[index];
  const rowNumber = index + 2; // data starts at sheet row 2, header is row 1

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
  if (outcomeType === "PASS_FAIL_QTY") {
    const passQty = Number(formValues[PASS_QTY_KEY]);
    const failQty = Number(formValues[FAIL_QTY_KEY]);
    if (!Number.isFinite(passQty) || passQty < 0 || !Number.isFinite(failQty) || failQty < 0) {
      throw new Error("Pass Qty aur Fail Qty non-negative number honi chahiye.");
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
    await runLedgerMovementAction(actionConfig, outcome, resolvedFields, run.Run_ID, input.completedBy);
  }

  const now = new Date();
  const deadline = parseStamp(run.TAT_Deadline);
  const isOnTime = !deadline || now <= deadline;
  const completedAt = formatStamp(now);
  const status = isOnTime ? "On Time" : "Delay Done";
  const remark = input.remark ?? "";
  const formDataJson = JSON.stringify(formValues);

  await updateModuleCells(MODULE_KEY, [
    {
      rowNumber,
      fields: {
        Completed_At: completedAt,
        Completed_By: input.completedBy,
        Outcome: outcome,
        Status: status,
        Remark: remark,
        Form_Data: formDataJson,
      },
    },
  ]);

  const completed: FmsRunRecord = {
    ...run,
    Completed_At: completedAt,
    Completed_By: input.completedBy,
    Outcome: outcome,
    Status: status,
    Remark: remark,
    Form_Data: formDataJson,
  };

  const nextMap = parseNextStepMap(step.Next_Step_Map);
  const target = nextMap[outcome];

  let next: FmsRunRecord | null = null;
  if (target && target !== "END") {
    const nextStepNo = Number(target);
    const nextStep = await getFmsTemplateStep(run.Template_ID, nextStepNo);
    if (nextStep) {
      next = await appendStepRun({
        instanceId: run.Instance_ID,
        templateId: run.Template_ID,
        templateName: run.Template_Name,
        contextRef: run.Context_Ref,
        startedBy: run.Started_By,
        startedAt: run.Started_At,
        stepNo: nextStepNo,
        stepName: nextStep.Step_Name,
        assignedTo: nextStep.Assigned_To,
        tatValue: Number(nextStep.TAT_Value),
        tatUnit: nextStep.TAT_Unit as FmsTatUnit,
      });
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

  return { completed, next };
}

/**
 * The one generic chaining primitive. Both a completed FMS step (above) and another
 * module's own code (e.g. src/lib/inward.ts after saving an entry) call this the same
 * way — it doesn't know or care which.
 */
export async function emitFmsEvent(sourceKey: string, contextRef: string): Promise<void> {
  const allSteps = await listFmsTemplates();
  const matchingFirstSteps = allSteps.filter(
    (s) => Number(s.Step_No) === 1 && s.Trigger_Event === sourceKey && s.Status === "Active"
  );

  for (const step of matchingFirstSteps) {
    try {
      await startFmsInstance({ templateId: step.Template_ID, contextRef, startedBy: "SYSTEM" });
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
  const runs = await getModuleRows<FmsRunRecord>(MODULE_KEY);
  const run = runs.find((r) => r.Run_ID === runId);
  if (!run) return null;

  const step = await getFmsTemplateStep(run.Template_ID, Number(run.Step_No));
  if (!step) return null;

  const dataSource = parseStepDataSourceConfig(step.Data_Source_Config);
  const referenceRows = dataSource.existing
    ? await resolveExistingFmsData(dataSource.existing, run.Context_Ref, run.Instance_ID)
    : [];

  return { run, step, dataSource, referenceRows };
}

export async function listMyPendingFmsSteps(userId: string): Promise<FmsRunRecord[]> {
  const runs = await getModuleRows<FmsRunRecord>(MODULE_KEY);
  return runs.filter((r) => r.Assigned_To === userId && r.Status === "Pending");
}

export async function listFmsInstanceHistory(instanceId: string): Promise<FmsRunRecord[]> {
  const runs = await getModuleRows<FmsRunRecord>(MODULE_KEY);
  return runs
    .filter((r) => r.Instance_ID === instanceId)
    .sort((a, b) => Number(a.Step_No) - Number(b.Step_No));
}

export async function listAllFmsRuns(): Promise<FmsRunRecord[]> {
  return getModuleRows<FmsRunRecord>(MODULE_KEY);
}

/**
 * Whether any instance is still mid-flow against this exact template version — the guard
 * a template Delete needs. Archiving alone never disturbs an already-running instance (it
 * keeps resolving steps from the archived version, on purpose); actually removing that
 * version's rows would leave a Pending step with no template left to resolve against, so
 * the API route checks this before calling deleteFmsTemplate.
 */
export async function hasPendingFmsRunsForTemplate(templateId: string): Promise<boolean> {
  const runs = await getModuleRows<FmsRunRecord>(MODULE_KEY);
  return runs.some((r) => r.Template_ID === templateId && r.Status === "Pending");
}
