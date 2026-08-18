import { getModuleRows } from "@/lib/moduleSheets";

const MODULE_KEY = "HOLIDAY_LIST";

interface HolidayRow {
  Date: string;
}

/** Reads the Holiday List sheet (column A, "Date" header in A1, dates from A2 down) as a
 * Set of "YYYY-MM-DD" strings for O(1) lookup. Dates must be entered as plain text in that
 * exact format — see the README setup note (Google Sheets otherwise reformats typed dates). */
export async function getHolidayDates(): Promise<Set<string>> {
  const rows = await getModuleRows<HolidayRow>(MODULE_KEY);
  return new Set(rows.map((r) => r.Date?.trim()).filter((d): d is string => Boolean(d)));
}
