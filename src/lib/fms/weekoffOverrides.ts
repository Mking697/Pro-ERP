import { appendModuleRow, getModuleRows, recordToRow } from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { nowStamp } from "@/lib/timestamp";

const MODULE_KEY = "FMS_WEEKOFF_OVERRIDES";

export type WeekoffScope = "ALL" | "DEPARTMENT" | "USER";

export interface WeekoffOverrideRecord {
  Override_ID: string;
  /** YYYY-MM-DD, plain text — same convention as HOLIDAY_LIST. */
  Date: string;
  Scope: string;
  Scope_Value: string;
  Created_By: string;
  Created_At: string;
}

export async function listWeekoffOverrides(): Promise<WeekoffOverrideRecord[]> {
  return getModuleRows<WeekoffOverrideRecord>(MODULE_KEY);
}

interface AddWeekoffOverrideInput {
  date: string;
  scope: WeekoffScope;
  scopeValue: string;
  createdBy: string;
}

/** A weekly-off date opened back up for everyone, one department, or one person — the
 * only direction needed: presence of a row means "working," absence means the normal
 * weekly-off still applies. */
export async function addWeekoffOverride(
  input: AddWeekoffOverrideInput
): Promise<WeekoffOverrideRecord> {
  const record: WeekoffOverrideRecord = {
    Override_ID: generateId("OVR"),
    Date: input.date,
    Scope: input.scope,
    Scope_Value: input.scope === "ALL" ? "" : input.scopeValue,
    Created_By: input.createdBy,
    Created_At: nowStamp(),
  };
  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return record;
}

/** Whether an override row's scope covers this user (by department or by name). */
export function overrideAppliesToUser(
  override: WeekoffOverrideRecord,
  userId: string,
  department: string
): boolean {
  if (override.Scope === "ALL") return true;
  if (override.Scope === "DEPARTMENT") return override.Scope_Value === department;
  if (override.Scope === "USER") return override.Scope_Value === userId;
  return false;
}
