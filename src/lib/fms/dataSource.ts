/**
 * Types and JSON-safe (de)serializers for an FMS step's Data Source — where the person
 * completing a step gets their input from. Pure, no server imports (mirrors the small
 * parsing helpers in src/lib/fms/templates.ts), so both server code and client UI can
 * import it without pulling Sheets/Google code into the browser bundle.
 *
 * A step's `form` and `existing` pulls are independent, not exclusive — a real production
 * step routinely needs both at once: someone types a Pass/Fail quantity into a Form
 * *while also* seeing the product's SKU and the previous step's pass quantity pulled live
 * from elsewhere. Either, both, or neither can be present on the same step.
 */

export type FormFieldType = "text" | "number" | "date" | "dropdown" | "attachment" | "lookup";

/**
 * Config for a "lookup" field — the doer picks a row from another connected module (e.g.
 * Customers) and its own value plus every mapped column autofill onto other fields of the
 * *same* step's form, the instant the doer picks it. Generic: works for CUSTOMERS,
 * VENDORS, or any future MODULE_SHEETS key exactly the same way.
 */
export interface FormFieldLookup {
  /** A MODULE_SHEETS key (e.g. "CUSTOMERS") — the module rows are searched/selected from. */
  sourceModule: string;
  /** Which column of that module is shown as the option label and searched on (e.g. "Customer_Name"). */
  displayField: string;
  /** target FormField.key on this SAME step -> source column name in sourceModule.
   * When the doer picks a row, every key here gets that row's value for that column. */
  autofillMap: Record<string, string>;
}

export interface FormField {
  /** Stable key this field's value is stored under in Form_Data, and the key an Action
   * (see src/lib/fms/actions.ts) can bind to. */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Only meaningful for type "dropdown". */
  options?: string[];
  /** Only meaningful for type "lookup". */
  lookup?: FormFieldLookup;
}

export interface FormDataSourceConfig {
  fields: FormField[];
}

/** Sentinel `sourceModule` meaning "an earlier step of this same running instance",
 * rather than a real MODULE_SHEETS key. */
export const THIS_FLOW_SOURCE = "THIS_FLOW";

export interface ExistingFmsDataSourceConfig {
  /** A MODULE_SHEETS key (e.g. "PRODUCTION_PLANS"), or THIS_FLOW_SOURCE. */
  sourceModule: string;
  /** Required when sourceModule === THIS_FLOW_SOURCE: which earlier Step_No to read. */
  sourceStepNo?: number;
  /** Which columns to pull — real sheet headers (or, for THIS_FLOW, the earlier step's
   * own Form_Data keys plus its Outcome/Step_Name). */
  columns: string[];
  /** true = only the row(s) tied to this instance's own Context_Ref id; false = every
   * row of the source (e.g. a lookup list with nothing to filter by). */
  filterByContext: boolean;
}

/** A step's whole Data Source — both halves optional and independent. */
export interface StepDataSourceConfig {
  form?: FormDataSourceConfig;
  existing?: ExistingFmsDataSourceConfig;
}

/** Well-shaped or the field's `lookup` config is dropped — a malformed/tampered lookup
 * config must never reach the resolver as if it were trustworthy. */
function sanitizeLookup(raw: unknown): FormFieldLookup | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const l = raw as Partial<FormFieldLookup>;
  if (typeof l.sourceModule !== "string" || !l.sourceModule) return undefined;
  if (typeof l.displayField !== "string" || !l.displayField) return undefined;
  const autofillMap: Record<string, string> = {};
  if (l.autofillMap && typeof l.autofillMap === "object") {
    for (const [k, v] of Object.entries(l.autofillMap)) {
      if (typeof v === "string" && v) autofillMap[k] = v;
    }
  }
  return { sourceModule: l.sourceModule, displayField: l.displayField, autofillMap };
}

function sanitizeFormField(raw: unknown): FormField | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Partial<FormField>;
  if (typeof f.key !== "string" || !f.key) return null;
  if (typeof f.label !== "string") return null;
  if (typeof f.type !== "string") return null;
  const field: FormField = {
    key: f.key,
    label: f.label,
    type: f.type as FormFieldType,
    required: Boolean(f.required),
    options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : undefined,
  };
  if (field.type === "lookup") {
    const lookup = sanitizeLookup(f.lookup);
    if (lookup) field.lookup = lookup;
  }
  return field;
}

export function parseStepDataSourceConfig(raw: string | undefined | null): StepDataSourceConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<StepDataSourceConfig>;
    const config: StepDataSourceConfig = {};

    if (parsed.form && Array.isArray(parsed.form.fields)) {
      config.form = {
        fields: parsed.form.fields
          .map((f) => sanitizeFormField(f))
          .filter((f): f is FormField => f !== null),
      };
    }

    const existing = parsed.existing;
    if (existing && existing.sourceModule && Array.isArray(existing.columns)) {
      config.existing = {
        sourceModule: existing.sourceModule,
        sourceStepNo: existing.sourceStepNo,
        columns: existing.columns,
        filterByContext: Boolean(existing.filterByContext),
      };
    }

    return config;
  } catch {
    return {};
  }
}

export function serializeStepDataSourceConfig(config: StepDataSourceConfig): string {
  return JSON.stringify(config);
}

/** A short tag describing which halves of a Data Source are present — derived from the
 * config itself rather than trusted from the client, so it can never drift out of sync
 * with what's actually configured. Used for display only; engine logic checks the config
 * object's own `form`/`existing` presence directly. */
export function describeDataSourceType(config: StepDataSourceConfig): string {
  if (config.form && config.existing) return "FORM_AND_EXISTING";
  if (config.form) return "FORM";
  if (config.existing) return "EXISTING_FMS";
  return "";
}

/** Which of a form's fields are missing from a submitted values map. */
export function missingRequiredFields(
  config: FormDataSourceConfig,
  values: Record<string, string>
): FormField[] {
  return config.fields.filter((f) => f.required && !values[f.key]?.trim());
}

/** Parses whatever a completer typed, stored as Form_Data JSON on an FMS_RUNS row. */
export function parseFormData(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = String(v ?? "");
    return out;
  } catch {
    return {};
  }
}
