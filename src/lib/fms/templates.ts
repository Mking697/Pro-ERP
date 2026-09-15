import {
  appendModuleRows,
  getModuleRows,
  updateModuleCells,
  deleteModuleRows,
  recordToRow,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { nowStamp } from "@/lib/timestamp";
import { describeDataSourceType, parseStepDataSourceConfig } from "@/lib/fms/dataSource";

const MODULE_KEY = "FMS_TEMPLATES";

export interface FmsTemplateStepRecord {
  Template_ID: string;
  Template_Name: string;
  Trigger_Event: string;
  Status: string;
  Created_By: string;
  Created_At: string;
  Step_No: string;
  Step_Name: string;
  Assigned_To: string;
  TAT_Value: string;
  TAT_Unit: string;
  Outcome_Options: string;
  Next_Step_Map: string;
  /** "" | "FORM" | "EXISTING_FMS" — see src/lib/fms/dataSource.ts. */
  Data_Source_Type: string;
  /** JSON — FormDataSourceConfig or ExistingFmsDataSourceConfig, matching Data_Source_Type. */
  Data_Source_Config: string;
  /** "" | "LEDGER_MOVEMENT" — see src/lib/fms/actions.ts. */
  Action_Type: string;
  /** JSON — LedgerMovementActionConfig, matching Action_Type. */
  Action_Config: string;
  /** "" | "DONE" | "PASS_FAIL" | "PASS_FAIL_QTY" | "NUMBER" | "TEXT" | "ATTACHMENT" —
   * see src/lib/fms/outcomeType.ts. "" means Outcome_Options was hand-typed (a template
   * built before this existed, or a genuinely custom outcome list). */
  Outcome_Type: string;
  /** Blank keeps TAT_Value/TAT_Unit fixed. Set (an earlier Step_No of the same template)
   * and the deadline is read from that step's own Form_Data field (TAT_Source_Field_Key)
   * plus TAT_Offset instead — see src/lib/fms/engine.ts's resolveTatValue(). */
  TAT_Source_Step_No: string;
  TAT_Source_Field_Key: string;
  TAT_Offset: string;
}

export type FmsTatUnit = "Hours" | "Days";

export interface FmsTemplateStepInput {
  stepNo: number;
  stepName: string;
  assignedTo: string;
  tatValue: number;
  tatUnit: FmsTatUnit;
  outcomeOptions: string[];
  /** outcome -> next Step_No, or "END" to finish the flow. */
  nextStepMap: Record<string, number | "END">;
  /** Already-serialized StepDataSourceConfig JSON (or "{}"/"" for no data source at all). */
  dataSourceConfig: string;
  actionType: "" | "LEDGER_MOVEMENT";
  /** Already-serialized JSON (or "" when actionType is ""). */
  actionConfig: string;
  /** Already-validated OutcomeType (or "" for Custom) — see src/lib/fms/outcomeType.ts. */
  outcomeType: string;
  /** "" keeps tatValue/tatUnit fixed; a Step_No sources the deadline from that earlier
   * step's own field instead — see FmsTemplateStepRecord.TAT_Source_Step_No. */
  tatSourceStepNo: string;
  tatSourceFieldKey: string;
  tatOffset: number;
}

export interface CreateFmsTemplateInput {
  templateName: string;
  /** "MANUAL", or an event key like "INWARD_ENTRY_CREATED" / "FMS:<Template_ID>:<Step_No>:<Outcome>". */
  triggerEvent: string;
  createdBy: string;
  steps: FmsTemplateStepInput[];
}

function serializeNextStepMap(map: Record<string, number | "END">): string {
  return Object.entries(map)
    .map(([outcome, target]) => `${outcome}:${target}`)
    .join(";");
}

/** "Pass:3;Fail:5" -> { Pass: "3", Fail: "5" }. Target is a Step_No string, or "END". */
export function parseNextStepMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw) return map;
  for (const pair of raw.split(";")) {
    const [outcome, target] = pair.split(":");
    if (outcome?.trim() && target?.trim()) map[outcome.trim()] = target.trim();
  }
  return map;
}

export function parseOutcomeOptions(raw: string): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every step row of every template — filter/group by Template_ID to get one flow. */
export async function listFmsTemplates(): Promise<FmsTemplateStepRecord[]> {
  return getModuleRows<FmsTemplateStepRecord>(MODULE_KEY);
}

export async function getFmsTemplateSteps(templateId: string): Promise<FmsTemplateStepRecord[]> {
  const rows = await listFmsTemplates();
  return rows
    .filter((r) => r.Template_ID === templateId)
    .sort((a, b) => Number(a.Step_No) - Number(b.Step_No));
}

export async function getFmsTemplateStep(
  templateId: string,
  stepNo: number
): Promise<FmsTemplateStepRecord | null> {
  const steps = await getFmsTemplateSteps(templateId);
  return steps.find((s) => Number(s.Step_No) === stepNo) ?? null;
}

export interface FmsNavTemplate {
  templateId: string;
  templateName: string;
}

/**
 * Whether a user may open a template's own Flow Board — as a nav item, or the page itself.
 * An FMS_ADMIN always may; anyone else only when the template's own step design assigns
 * them somewhere (Assigned_To, chosen from a user dropdown at template-build time). This
 * is a design-time check on FMS_TEMPLATES rows, not a runtime lookup of who currently
 * holds a Pending FMS_RUNS step — a person keeps their flow's nav item even between
 * instances, and between their own steps within one.
 */
export function userCanAccessTemplate(
  steps: FmsTemplateStepRecord[],
  userId: string,
  isAdmin: boolean
): boolean {
  return isAdmin || steps.some((s) => s.Assigned_To === userId);
}

/**
 * Every Active template that should get its own nav item for this user — every Active
 * template for an FMS_ADMIN, or only the ones whose static step design assigns this user
 * otherwise (see userCanAccessTemplate). A template is stored as one row per step, so this
 * groups/dedupes by Template_ID, keeping each one's own Template_Name.
 *
 * Callers should wrap this in tenantCached with a short TTL — it runs on every page load
 * via AppShell, so an uncached full FMS_TEMPLATES read here would make the project's
 * already-documented Sheets-quota problem worse.
 */
export async function listNavFmsTemplates(
  userId: string,
  isAdmin: boolean
): Promise<FmsNavTemplate[]> {
  const steps = (await listFmsTemplates()).filter((s) => s.Status === "Active");

  const byTemplate = new Map<string, FmsTemplateStepRecord[]>();
  for (const step of steps) {
    const list = byTemplate.get(step.Template_ID) ?? [];
    list.push(step);
    byTemplate.set(step.Template_ID, list);
  }

  const out: FmsNavTemplate[] = [];
  for (const [templateId, templateSteps] of byTemplate) {
    if (!userCanAccessTemplate(templateSteps, userId, isAdmin)) continue;
    out.push({ templateId, templateName: templateSteps[0].Template_Name });
  }
  return out;
}

/** Mints a Template_ID and appends every step as one row each, in a single sheet write. */
export async function createFmsTemplate(input: CreateFmsTemplateInput): Promise<string> {
  if (input.steps.length === 0) {
    throw new Error("Template me kam se kam ek step chahiye.");
  }

  const templateId = generateId("FTP");
  const createdAt = nowStamp();

  const rows = input.steps.map((step) => {
    const record: FmsTemplateStepRecord = {
      Template_ID: templateId,
      Template_Name: input.templateName,
      Trigger_Event: input.triggerEvent,
      Status: "Active",
      Created_By: input.createdBy,
      Created_At: createdAt,
      Step_No: String(step.stepNo),
      Step_Name: step.stepName,
      Assigned_To: step.assignedTo,
      TAT_Value: String(step.tatValue),
      TAT_Unit: step.tatUnit,
      Outcome_Options: step.outcomeOptions.join(","),
      Next_Step_Map: serializeNextStepMap(step.nextStepMap),
      // Derived from the config itself, never trusted from the client, so it can never
      // drift out of sync with what's actually configured.
      Data_Source_Type: describeDataSourceType(parseStepDataSourceConfig(step.dataSourceConfig)),
      Data_Source_Config: step.dataSourceConfig,
      Action_Type: step.actionType,
      Action_Config: step.actionConfig,
      Outcome_Type: step.outcomeType,
      TAT_Source_Step_No: step.tatSourceStepNo,
      TAT_Source_Field_Key: step.tatSourceFieldKey,
      TAT_Offset: step.tatSourceStepNo ? String(step.tatOffset) : "",
    };
    return recordToRow(MODULE_KEY, record);
  });

  await appendModuleRows(MODULE_KEY, rows);
  return templateId;
}

/**
 * Edits a template by writing a new version and archiving the old one — never rewriting
 * rows in place, the same way BOM handles a re-save. Any instance already running against
 * the old Template_ID keeps resolving its steps from it (getFmsTemplateStep doesn't filter
 * by Status), so an in-flight flow is never disturbed by an edit made while it's open; only
 * a *new* instance (manual Start, or an event trigger) ever sees the edited version.
 *
 * Creates the new version first and archives the old one second — if archiving fails, the
 * org is briefly left with two Active versions (harmless, easy to notice and fix by hand)
 * rather than zero (which would silently stop anything from starting).
 */
export async function updateFmsTemplate(
  oldTemplateId: string,
  input: CreateFmsTemplateInput
): Promise<string> {
  const newTemplateId = await createFmsTemplate(input);
  await setFmsTemplateStatus(oldTemplateId, "Archived");
  return newTemplateId;
}

/**
 * Flips every row of a template to a new Status in one batch write.
 *
 * A template is many rows (one per step), so this can't go through updateModuleRow —
 * row numbers are derived from read order (data starts at sheet row 2) the same way
 * findModuleRow/getModuleRowNumbers do it internally.
 */
export async function setFmsTemplateStatus(
  templateId: string,
  status: "Active" | "Archived"
): Promise<void> {
  const rows = await getModuleRows<FmsTemplateStepRecord>(MODULE_KEY);
  const updates = rows
    .map((record, i) => ({ record, rowNumber: i + 2 }))
    .filter(({ record }) => record.Template_ID === templateId)
    .map(({ rowNumber }) => ({ rowNumber, fields: { Status: status } }));

  if (updates.length === 0) {
    throw new Error("Template nahi mila.");
  }

  await updateModuleCells(MODULE_KEY, updates);
}

/**
 * Permanently removes every row of one template version — only ever an Archived one.
 * Deleting an Active template out from under a running instance, or a trigger that still
 * routes to it, would break it invisibly; Archive is what actually retires a template from
 * new use, and Delete is only for tidying old versions nobody needs any more. The caller
 * (the API route) is expected to also refuse this when a Pending FMS_RUNS step still
 * references the template — this function only knows about FMS_TEMPLATES.
 */
export async function deleteFmsTemplate(templateId: string): Promise<void> {
  const rows = await getModuleRows<FmsTemplateStepRecord>(MODULE_KEY);
  const matches = rows
    .map((record, i) => ({ record, rowNumber: i + 2 }))
    .filter(({ record }) => record.Template_ID === templateId);

  if (matches.length === 0) {
    throw new Error("Template nahi mila.");
  }
  if (matches.some(({ record }) => record.Status !== "Archived")) {
    throw new Error("Sirf Archived template delete ki ja sakti hai — pehle Archive karein.");
  }

  await deleteModuleRows(
    MODULE_KEY,
    matches.map(({ rowNumber }) => rowNumber)
  );
}
