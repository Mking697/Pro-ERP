import { appendModuleRows, getModuleRows, updateModuleCells, recordToRow } from "@/lib/moduleSheets";
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
    };
    return recordToRow(MODULE_KEY, record);
  });

  await appendModuleRows(MODULE_KEY, rows);
  return templateId;
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
