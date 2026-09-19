import { and, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { fmsTemplates } from "@/db/schema";
import { db } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { describeDataSourceType, parseStepDataSourceConfig } from "@/lib/fms/dataSource";
import { parseLedgerMovementActionConfig } from "@/lib/fms/actions";

/**
 * `fms_templates` has the composite primary key `(template_id, step_no)` — one row per
 * step, a template's metadata (name, trigger, status) repeated on every one of its rows,
 * exactly mirroring the old sheet's flat shape (same reasoning as `bom`'s `(bom_id,
 * line_no)`). Per repo.ts's `IdentifiedTable` doc comment this does NOT satisfy the
 * generic findById/updateById/deleteById layer, so every query here is a direct, bespoke
 * Drizzle query instead.
 */
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
  /** Still a semicolon string at this API boundary ("Pass:3;Fail:5") — unchanged, since
   * fms-template-form.tsx / template-format.ts on the frontend parse exactly this shape.
   * Only the storage underneath (fms_templates.next_step_map, a jsonb column) moved from
   * this same semicolon string — which was never actually valid JSON, so it could never
   * really have been written to a jsonb column under Sheets either — to a real JSON
   * object. See nextStepMapToStorage/nextStepMapFromStorage below. */
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
  /** User IDs to WhatsApp-notify the moment this step is marked complete — independent of
   * who the next step's own run gets created for. See src/lib/fms/engine.ts's
   * completeFmsStep, which sends these after the step's own row is updated. */
  Notify_On_Complete: string[];
}

export type FmsTatUnit = "Minutes" | "Hours" | "Days";

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
  /** See FmsTemplateStepRecord.Notify_On_Complete. */
  notifyOnComplete: string[];
}

export interface CreateFmsTemplateInput {
  templateName: string;
  /** "MANUAL", or an event key like "INWARD_ENTRY_CREATED" / "FMS:<Template_ID>:<Step_No>:<Outcome>". */
  triggerEvent: string;
  createdBy: string;
  steps: FmsTemplateStepInput[];
}

/** outcome -> target -> the real JSON object fms_templates.next_step_map now stores. */
function nextStepMapToStorage(map: Record<string, number | "END">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [outcome, target] of Object.entries(map)) out[outcome] = String(target);
  return out;
}

/** The inverse — and what FmsTemplateStepRecord.Next_Step_Map (still a semicolon string
 * at the API boundary, unchanged) is built from on every read. */
function nextStepMapFromStorage(json: Record<string, string> | null | undefined): string {
  if (!json) return "";
  return Object.entries(json)
    .map(([outcome, target]) => `${outcome}:${target}`)
    .join(";");
}

/** "Pass:3;Fail:5" -> { Pass: "3", Fail: "5" }. Target is a Step_No string, or "END".
 * Unchanged — still parses the same semicolon string FmsTemplateStepRecord.Next_Step_Map
 * has always carried at this boundary; only the storage underneath moved to real JSON. */
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

type TemplateRow = InferSelectModel<typeof fmsTemplates>;

function rowToRecord(row: TemplateRow): FmsTemplateStepRecord {
  return {
    Template_ID: row.templateId,
    Template_Name: row.templateName,
    Trigger_Event: row.triggerEvent,
    Status: row.status,
    Created_By: row.createdBy,
    Created_At: row.createdAt.toISOString(),
    Step_No: String(row.stepNo),
    Step_Name: row.stepName,
    Assigned_To: row.assignedTo,
    TAT_Value: row.tatValue ?? "",
    TAT_Unit: row.tatUnit,
    Outcome_Options: row.outcomeOptions,
    Next_Step_Map: nextStepMapFromStorage(row.nextStepMap),
    Data_Source_Type: row.dataSourceType,
    Data_Source_Config: row.dataSourceConfig ? JSON.stringify(row.dataSourceConfig) : "",
    Action_Type: row.actionType,
    Action_Config: row.actionConfig ? JSON.stringify(row.actionConfig) : "",
    Outcome_Type: row.outcomeType,
    TAT_Source_Step_No: row.tatSourceStepNo !== null ? String(row.tatSourceStepNo) : "",
    TAT_Source_Field_Key: row.tatSourceFieldKey,
    TAT_Offset: row.tatOffset ?? "",
    Notify_On_Complete: row.notifyOnComplete ?? [],
  };
}

/** Every step row of every template — filter/group by Template_ID to get one flow. */
export async function listFmsTemplates(): Promise<FmsTemplateStepRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(fmsTemplates).where(eq(fmsTemplates.orgId, orgId));
  return rows.map(rowToRecord);
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
  /** "MANUAL", or an event key like "PRODUCTION_STARTED" — see FmsTemplateStepRecord's own
   * doc comment. The nav bar uses this to decide whether a flow is a PPC-connected
   * "PMS" Line or belongs in the generic FMS group. */
  triggerEvent: string;
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
    out.push({
      templateId,
      templateName: templateSteps[0].Template_Name,
      triggerEvent: templateSteps[0].Trigger_Event,
    });
  }
  return out;
}

/** Mints a Template_ID and inserts every step as one row each, in a single insert. */
export async function createFmsTemplate(input: CreateFmsTemplateInput): Promise<string> {
  if (input.steps.length === 0) {
    throw new Error("Template me kam se kam ek step chahiye.");
  }

  const orgId = await getTenantOrgId();
  const templateId = generateId("FTP");
  const createdAt = new Date();

  const rows = input.steps.map((step) => {
    const dataSourceConfig = parseStepDataSourceConfig(step.dataSourceConfig);
    return {
      templateId,
      orgId,
      templateName: input.templateName,
      triggerEvent: input.triggerEvent,
      status: "Active" as const,
      createdBy: input.createdBy,
      createdAt,
      stepNo: step.stepNo,
      stepName: step.stepName,
      assignedTo: step.assignedTo,
      tatValue: String(step.tatValue),
      tatUnit: step.tatUnit,
      outcomeOptions: step.outcomeOptions.join(","),
      nextStepMap: nextStepMapToStorage(step.nextStepMap),
      // Derived from the config itself, never trusted from the client, so it can never
      // drift out of sync with what's actually configured.
      dataSourceType: describeDataSourceType(dataSourceConfig) as
        | ""
        | "FORM"
        | "EXISTING_FMS"
        | "FORM_AND_EXISTING",
      dataSourceConfig,
      actionType: step.actionType,
      actionConfig: parseLedgerMovementActionConfig(step.actionConfig),
      outcomeType: step.outcomeType as
        | ""
        | "DONE"
        | "PASS_FAIL"
        | "PASS_FAIL_QTY"
        | "NUMBER"
        | "TEXT"
        | "ATTACHMENT",
      tatSourceStepNo: step.tatSourceStepNo ? Number(step.tatSourceStepNo) : null,
      tatSourceFieldKey: step.tatSourceFieldKey,
      tatOffset: step.tatSourceStepNo ? String(step.tatOffset) : null,
      notifyOnComplete: step.notifyOnComplete,
    };
  });

  await db.insert(fmsTemplates).values(rows);
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

/** Flips every row of a template to a new Status in one write. */
export async function setFmsTemplateStatus(
  templateId: string,
  status: "Active" | "Archived"
): Promise<void> {
  const orgId = await getTenantOrgId();
  const updated = await db
    .update(fmsTemplates)
    .set({ status })
    .where(and(eq(fmsTemplates.orgId, orgId), eq(fmsTemplates.templateId, templateId)))
    .returning({ templateId: fmsTemplates.templateId });

  if (updated.length === 0) {
    throw new Error("Template nahi mila.");
  }
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
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({ status: fmsTemplates.status })
    .from(fmsTemplates)
    .where(and(eq(fmsTemplates.orgId, orgId), eq(fmsTemplates.templateId, templateId)));

  if (rows.length === 0) {
    throw new Error("Template nahi mila.");
  }
  if (rows.some((r) => r.status !== "Archived")) {
    throw new Error("Sirf Archived template delete ki ja sakti hai — pehle Archive karein.");
  }

  await db
    .delete(fmsTemplates)
    .where(and(eq(fmsTemplates.orgId, orgId), eq(fmsTemplates.templateId, templateId)));
}
