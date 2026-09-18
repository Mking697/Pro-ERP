import { holidayList } from "@/db/schema";
import { listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";

/**
 * Reads the org's holiday dates as a Set of "YYYY-MM-DD" strings for O(1) lookup —
 * unchanged contract from the pre-Postgres sheet version (`getModuleRows` over
 * `HOLIDAY_LIST`, a bare "Date" column).
 *
 * `holiday_list`'s primary key is the composite `(org_id, date)` (see
 * src/db/schema/tasks.ts's own comment on why this table has no surrogate id), so it does
 * not satisfy repo.ts's `IdentifiedTable` constraint — only `listByOrg` applies here.
 * Postgres's `date` column comes back from Drizzle as a plain string (no `{ mode: "date" }`
 * configured), already in `YYYY-MM-DD` — no conversion needed, unlike every timestamptz
 * column elsewhere in this schema.
 *
 * There is no create/delete path for a holiday today (same as before this migration — the
 * old sheet had no write API either, only direct edits to the connected spreadsheet), so
 * this file stays read-only.
 */
export async function getHolidayDates(): Promise<Set<string>> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(holidayList, orgId);
  return new Set(rows.map((r) => r.date));
}
