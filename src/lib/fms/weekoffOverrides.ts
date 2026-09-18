import type { InferSelectModel } from "drizzle-orm";
import { fmsWeekoffOverrides } from "@/db/schema";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

export type WeekoffScope = "ALL" | "DEPARTMENT" | "USER";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `fms_weekoff_overrides`
 * Postgres table — `fms_weekoff_overrides` has a plain `id` (Override_ID) primary key, so
 * it goes through repo.ts's generic layer like `indents`, unlike `fms_templates`/`bom`.
 */
export interface WeekoffOverrideRecord {
  Override_ID: string;
  /** YYYY-MM-DD, plain text — same convention as HOLIDAY_LIST. Postgres's `date` column
   * comes back from Drizzle as a plain string already in this shape (see
   * src/lib/holidays.ts's own comment on the same point), no conversion needed. */
  Date: string;
  Scope: string;
  Scope_Value: string;
  Created_By: string;
  Created_At: string;
}

type WeekoffRow = InferSelectModel<typeof fmsWeekoffOverrides>;

function rowToRecord(row: WeekoffRow): WeekoffOverrideRecord {
  return {
    Override_ID: row.id,
    Date: row.date,
    Scope: row.scope,
    Scope_Value: row.scopeValue,
    Created_By: row.createdBy,
    Created_At: row.createdAt.toISOString(),
  };
}

export async function listWeekoffOverrides(): Promise<WeekoffOverrideRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(fmsWeekoffOverrides, orgId);
  return rows.map(rowToRecord);
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
  const orgId = await getTenantOrgId();
  const row = await insertRecord(fmsWeekoffOverrides, {
    id: generateId("OVR"),
    orgId,
    date: input.date,
    scope: input.scope,
    scopeValue: input.scope === "ALL" ? "" : input.scopeValue,
    createdBy: input.createdBy,
  });
  return rowToRecord(row);
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
