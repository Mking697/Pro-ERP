/**
 * Types and JSON-safe (de)serializers for an FMS step's Data Source — where the person
 * completing a step gets their input from. Pure, no server imports (mirrors the small
 * parsing helpers in src/lib/fms/templates.ts), so both server code and client UI can
 * import it without pulling Sheets/Google code into the browser bundle.
 *
 * Two kinds:
 *  - FORM: a small Google-Forms-style question set the completer fills in themselves.
 *  - EXISTING_FMS: columns live-pulled from another connected sheet (or an earlier step
 *    in the same flow) — read-only context, never edited by the completer.
 */

export type DataSourceType = "" | "FORM" | "EXISTING_FMS";

export type FormFieldType = "text" | "number" | "date" | "dropdown";

export interface FormField {
  /** Stable key this field's value is stored under in Form_Data, and the key an Action
   * (see src/lib/fms/actions.ts) can bind to. */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  /** Only meaningful for type "dropdown". */
  options?: string[];
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

export function parseDataSourceType(raw: string | undefined | null): DataSourceType {
  return raw === "FORM" || raw === "EXISTING_FMS" ? raw : "";
}

export function parseFormDataSourceConfig(raw: string | undefined | null): FormDataSourceConfig {
  if (!raw) return { fields: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<FormDataSourceConfig>;
    return { fields: Array.isArray(parsed.fields) ? parsed.fields : [] };
  } catch {
    return { fields: [] };
  }
}

export function parseExistingFmsDataSourceConfig(
  raw: string | undefined | null
): ExistingFmsDataSourceConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ExistingFmsDataSourceConfig>;
    if (!parsed.sourceModule || !Array.isArray(parsed.columns)) return null;
    return {
      sourceModule: parsed.sourceModule,
      sourceStepNo: parsed.sourceStepNo,
      columns: parsed.columns,
      filterByContext: Boolean(parsed.filterByContext),
    };
  } catch {
    return null;
  }
}

export function serializeDataSourceConfig(
  config: FormDataSourceConfig | ExistingFmsDataSourceConfig
): string {
  return JSON.stringify(config);
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
