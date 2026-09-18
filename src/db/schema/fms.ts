import {
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizations } from "./platform";
import type { LedgerMovementActionConfig } from "@/lib/fms/actions";
import type { StepDataSourceConfig } from "@/lib/fms/dataSource";

/**
 * Mirrors MODULE_SHEETS' FMS_TEMPLATES, FMS_RUNS and FMS_WEEKOFF_OVERRIDES —
 * src/lib/fms/templates.ts, engine.ts, actions.ts, dataSource.ts, outcomeType.ts,
 * weekoffOverrides.ts.
 *
 * FMS_TEMPLATES and FMS_RUNS keep their "one row per step / one row per step execution,
 * grouped by an id repeated across rows" shape exactly as it is today — this phase is
 * only translating column types, not normalizing the shape into a separate steps table
 * (that judgment call belongs to whoever rewrites fms/templates.ts and fms/engine.ts in
 * Phase 3, per this migration's own instructions).
 */

// FmsTemplateStepRecord.Status — src/lib/fms/templates.ts: "Active" while usable,
// "Archived" once a re-save mints a new Template_ID (never edited in place).
export const fmsTemplateStatusEnum = pgEnum("fms_template_status", ["Active", "Archived"]);

// Outcome_Type — src/lib/fms/outcomeType.ts OutcomeType. "" means Outcome_Options was
// hand-typed (a template built before this existed, or a genuinely custom outcome list).
export const fmsOutcomeTypeEnum = pgEnum("fms_outcome_type", [
  "",
  "DONE",
  "PASS_FAIL",
  "PASS_FAIL_QTY",
  "NUMBER",
  "TEXT",
  "ATTACHMENT",
]);

// Data_Source_Type — derived server-side from Data_Source_Config by
// describeDataSourceType() (src/lib/fms/dataSource.ts), never trusted from the client.
export const fmsDataSourceTypeEnum = pgEnum("fms_data_source_type", [
  "",
  "FORM",
  "EXISTING_FMS",
  "FORM_AND_EXISTING",
]);

// Action_Type — src/lib/fms/actions.ts ActionType. Only one real action exists today.
export const fmsActionTypeEnum = pgEnum("fms_action_type", ["", "LEDGER_MOVEMENT"]);

/**
 * One row per step, grouped by Template_ID — a template's metadata (name, trigger,
 * status) repeats on every one of its rows rather than living in a separate header row.
 * No per-row id in the source sheet, so the primary key is the natural composite
 * (template_id, step_no).
 */
export const fmsTemplates = pgTable(
  "fms_templates",
  {
    templateId: text("template_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    templateName: text("template_name").notNull(),
    // "MANUAL", or an event key like "INWARD_ENTRY_CREATED" / "PRODUCTION_STARTED" /
    // "FMS:<Template_ID>:<Step_No>:<Outcome>" — genuinely open-ended (dynamic chaining
    // keys), kept text.
    triggerEvent: text("trigger_event").notNull(),
    status: fmsTemplateStatusEnum("status").notNull().default("Active"),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    stepNo: integer("step_no").notNull(),
    stepName: text("step_name").notNull(),
    assignedTo: text("assigned_to").notNull().default(""),
    tatValue: numeric("tat_value"),
    tatUnit: text("tat_unit").notNull().default(""),
    // Comma-separated outcome labels today (e.g. "Pass,Fail"), NOT JSON in the current
    // Sheets serialization — see the note on next_step_map below.
    outcomeOptions: text("outcome_options").notNull().default(""),
    // JUDGMENT CALL: the migration plan's type-mapping table explicitly names
    // Next_Step_Map as one of the "JSON-encoded string columns -> jsonb". In the actual
    // running code (src/lib/fms/templates.ts serializeNextStepMap/parseNextStepMap) this
    // column is NOT JSON today — it's a custom "Pass:3;Fail:5" semicolon-delimited
    // string. jsonb enforces valid JSON on write, so this column stays unusable until
    // Phase 3's fms/templates.ts rewrite actually switches its serialization to real
    // JSON. Flagged here for the owner rather than silently "fixed" or silently left as
    // `text` against the plan's explicit instruction.
    nextStepMap: jsonb("next_step_map").$type<Record<string, string>>(),
    dataSourceType: fmsDataSourceTypeEnum("data_source_type").notNull().default(""),
    dataSourceConfig: jsonb("data_source_config").$type<StepDataSourceConfig>(),
    actionType: fmsActionTypeEnum("action_type").notNull().default(""),
    actionConfig: jsonb("action_config").$type<LedgerMovementActionConfig>(),
    outcomeType: fmsOutcomeTypeEnum("outcome_type").notNull().default(""),
    // Deadline sourcing from an earlier step's own field — see moduleSheets.ts's comment
    // on these three columns. Blank/null keeps the fixed TAT_Value/TAT_Unit behaviour.
    tatSourceStepNo: integer("tat_source_step_no"),
    tatSourceFieldKey: text("tat_source_field_key").notNull().default(""),
    tatOffset: numeric("tat_offset"),
    // User IDs to WhatsApp-notify the moment this step is marked complete — independent
    // of who the next step is assigned to (the existing chaining already reaches that
    // person by creating their run; this is for anyone who just needs to *know*, e.g. a
    // supervisor). Zero, one, or many. Mirrors users.moduleAccess's text[] convention.
    notifyOnComplete: text("notify_on_complete").array().notNull().default([]),
  },
  (table) => [primaryKey({ columns: [table.templateId, table.stepNo] })]
);

// FmsRunRecord.Status — src/lib/fms/engine.ts: "Pending" while open, then "On Time" or
// "Delay Done" once completed (same on-time/late framing as TaskRecord.Status, but FMS
// never has a task's "Done on Time" wording — it's "On Time").
export const fmsRunStatusEnum = pgEnum("fms_run_status", ["Pending", "On Time", "Delay Done"]);

export const fmsRuns = pgTable("fms_runs", {
  // Run_ID, e.g. "RUN-xxxx" — a real per-row generated id, unlike fms_templates above.
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  instanceId: text("instance_id").notNull(),
  templateId: text("template_id").notNull(),
  templateName: text("template_name").notNull().default(""),
  // Polymorphic pointer to whatever triggered this instance, e.g. "INWARD_IQC_FMS:INW-xxxx"
  // or "PRODUCTION_PLANS:PLN-xxxx" — deliberately not an FK, it spans multiple tables.
  contextRef: text("context_ref").notNull().default(""),
  startedBy: text("started_by").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }),
  stepNo: integer("step_no").notNull(),
  stepName: text("step_name").notNull(),
  assignedTo: text("assigned_to").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  tatStart: timestamp("tat_start", { withTimezone: true }),
  tatDeadline: timestamp("tat_deadline", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by").notNull().default(""),
  outcome: text("outcome").notNull().default(""),
  status: fmsRunStatusEnum("status").notNull().default("Pending"),
  remark: text("remark").notNull().default(""),
  // Whatever the completer typed into the step's own Data Source form — genuine JSON
  // today (JSON.stringify in engine.ts), unlike next_step_map/outcome_options above.
  formData: jsonb("form_data").$type<Record<string, string>>(),
  // How many physical units this run is handling — blank/null for a flow that never
  // tracks quantity.
  quantity: numeric("quantity"),
});

export const fmsWeekoffScopeEnum = pgEnum("fms_weekoff_scope", ["ALL", "DEPARTMENT", "USER"]);

export const fmsWeekoffOverrides = pgTable("fms_weekoff_overrides", {
  // Override_ID, e.g. "OVR-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  // Plain calendar date, no time component — same convention (and same judgment call)
  // as Holiday_List.
  date: date("date").notNull(),
  scope: fmsWeekoffScopeEnum("scope").notNull(),
  scopeValue: text("scope_value").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
