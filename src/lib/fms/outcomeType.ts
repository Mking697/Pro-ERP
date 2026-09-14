/**
 * A step's Outcome Type — chosen once, at template-build time — decides both what
 * branching outcomes the step can produce (Outcome_Options) and what the person
 * completing it actually has to fill in. Pure, no server imports (same convention as
 * dataSource.ts and actions.ts), so both the template builder and the completion dialog
 * can import it.
 *
 * "" (Custom) keeps the original free-typed comma list alive for templates built before
 * this existed, and for the rare flow whose outcomes really are bespoke words like
 * "Approved"/"Escalated" that don't fit a preset.
 */
import { slugify } from "@/lib/id";
import type { FormField } from "./dataSource";

export type OutcomeType = "" | "DONE" | "PASS_FAIL" | "PASS_FAIL_QTY" | "NUMBER" | "TEXT" | "ATTACHMENT";

/** Stable Form_Data keys a preset's built-in field(s) always land under — an Action's
 * SKU/Qty field dropdown and the engine's own Pass/Fail-from-qty logic bind to these. */
export const PASS_QTY_KEY = slugify("Pass Qty");
export const FAIL_QTY_KEY = slugify("Fail Qty");
export const SCRAP_QTY_KEY = slugify("Scrap Qty");
export const VALUE_KEY = slugify("Value");
export const ATTACHMENT_KEY = slugify("Attachment");

export interface OutcomeTypeDef {
  value: Exclude<OutcomeType, "">;
  label: string;
  /** The step's Outcome_Options, fixed by the preset — never hand-typed. */
  outcomes: string[];
  /** Data Source Form fields the preset auto-manages; the completer fills these in,
   * not a raw Outcome dropdown. Empty for presets with no extra capture (Done, Pass/Fail). */
  builtInFields: FormField[];
}

export const OUTCOME_TYPE_DEFS: OutcomeTypeDef[] = [
  { value: "DONE", label: "Done", outcomes: ["Done"], builtInFields: [] },
  { value: "PASS_FAIL", label: "Pass aur Fail", outcomes: ["Pass", "Fail"], builtInFields: [] },
  {
    value: "PASS_FAIL_QTY",
    label: "Pass, Fail aur Scrap Qty",
    outcomes: ["Pass", "Fail"],
    builtInFields: [
      { key: PASS_QTY_KEY, label: "Pass Qty", type: "number", required: true },
      { key: FAIL_QTY_KEY, label: "Fail Qty", type: "number", required: true },
      // Optional — most completions have none. A run's Fail Qty always loops back to
      // this same step for rework (see the engine); Scrap Qty is the only way a unit
      // ever leaves that loop without passing — it just stops, nothing moves anywhere.
      { key: SCRAP_QTY_KEY, label: "Scrap Qty", type: "number", required: false },
    ],
  },
  {
    value: "NUMBER",
    label: "Number",
    outcomes: ["Done"],
    builtInFields: [{ key: VALUE_KEY, label: "Value", type: "number", required: true }],
  },
  {
    value: "TEXT",
    label: "Text",
    outcomes: ["Done"],
    builtInFields: [{ key: VALUE_KEY, label: "Value", type: "text", required: true }],
  },
  {
    value: "ATTACHMENT",
    label: "Attachment",
    outcomes: ["Done"],
    builtInFields: [{ key: ATTACHMENT_KEY, label: "Attachment", type: "attachment", required: true }],
  },
];

export function parseOutcomeType(raw: string | undefined | null): OutcomeType {
  return OUTCOME_TYPE_DEFS.some((d) => d.value === raw) ? (raw as OutcomeType) : "";
}

export function outcomeTypeDef(type: OutcomeType): OutcomeTypeDef | null {
  return OUTCOME_TYPE_DEFS.find((d) => d.value === type) ?? null;
}

/** PASS_FAIL_QTY has no Outcome dropdown for the completer to pick — the branch follows
 * the numbers they entered, the same way Inward IQC already treats any nonzero fail
 * quantity as a real failure rather than trusting a separately-picked label. */
export function deriveOutcomeFromQty(formValues: Record<string, string>): string {
  return Number(formValues[FAIL_QTY_KEY] || 0) > 0 ? "Fail" : "Pass";
}

/** Pass + Fail + Scrap, as actually typed in. Every unit a PASS_FAIL_QTY run holds has to
 * end up counted somewhere — moving on, back for rework, or written off — so this is what
 * gets checked against the run's own incoming Quantity before a completion is accepted. */
export function qtySplitTotal(formValues: Record<string, string>): number {
  return (
    Number(formValues[PASS_QTY_KEY] || 0) +
    Number(formValues[FAIL_QTY_KEY] || 0) +
    Number(formValues[SCRAP_QTY_KEY] || 0)
  );
}
