import { and, eq } from "drizzle-orm";
import { holidayList } from "@/db/schema";
import { db } from "@/db/client";
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
 */
export async function getHolidayDates(): Promise<Set<string>> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(holidayList, orgId);
  return new Set(rows.map((r) => r.date));
}

export interface HolidayRecord {
  Date: string;
  Name: string;
}

/** Every holiday, newest first, for the Admin's own Holiday List screen. */
export async function listHolidays(): Promise<HolidayRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(holidayList, orgId);
  return rows
    .map((r) => ({ Date: r.date, Name: r.name }))
    .sort((a, b) => (a.Date < b.Date ? 1 : -1));
}

/** Adds one holiday, or updates its name if that date is already on the list — same
 * "re-adding is how you edit it" convention as vendor_items' upsertVendorItem. */
export async function upsertHoliday(date: string, name: string): Promise<HolidayRecord> {
  const orgId = await getTenantOrgId();
  await db
    .insert(holidayList)
    .values({ orgId, date, name: name.trim() })
    .onConflictDoUpdate({
      target: [holidayList.orgId, holidayList.date],
      set: { name: name.trim() },
    });
  return { Date: date, Name: name.trim() };
}

export async function deleteHoliday(date: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .delete(holidayList)
    .where(and(eq(holidayList.orgId, orgId), eq(holidayList.date, date)))
    .returning({ date: holidayList.date });
  return rows.length > 0;
}

export interface BulkHolidayRowInput {
  /** 1-based row number in the uploaded file (header row is 1), only for error messages. */
  row: number;
  date: string;
  name?: string;
}

export interface BulkHolidayResult {
  created: { row: number; holiday: HolidayRecord }[];
  errors: { row: number; message: string }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Same one-row-per-insert shape as createVendorsBulk/createItemsBulk — no bulk-insert
 * primitive in repo.ts yet, and a holiday list is small enough that it doesn't need one. */
export async function upsertHolidaysBulk(inputs: BulkHolidayRowInput[]): Promise<BulkHolidayResult> {
  const created: { row: number; holiday: HolidayRecord }[] = [];
  const errors: { row: number; message: string }[] = [];

  for (const input of inputs) {
    const date = input.date.trim();
    if (!DATE_RE.test(date)) {
      errors.push({ row: input.row, message: `"${input.date}" ek valid date (YYYY-MM-DD) nahi hai.` });
      continue;
    }
    const holiday = await upsertHoliday(date, input.name ?? "");
    created.push({ row: input.row, holiday });
  }

  return { created, errors };
}
