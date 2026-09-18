import { getSetting } from "@/lib/settings";
import { getUserById } from "@/lib/auth/users";
import { getHolidayDates } from "@/lib/holidays";
import { listWeekoffOverrides, overrideAppliesToUser } from "@/lib/fms/weekoffOverrides";
import {
  nextWorkingInstant as pureNextWorkingInstant,
  addWorkingMinutes as pureAddWorkingMinutes,
  endOfWorkingDay as pureEndOfWorkingDay,
  type WeekSchedule,
  type CalendarOverrides,
  type DayWindow,
} from "@/lib/fms/workingCalendar";
import type { FmsTatUnit } from "@/lib/fms/templates";

const DEFAULT_SHIFT_ID = "1";
const DEFAULT_MINUTES_PER_DAY = 480; // 8h fallback if a shift somehow resolves to no windows

interface ShiftTimes {
  start: string;
  end: string;
  lunchStart: string;
  lunchEnd: string;
  teaStart: string;
  teaEnd: string;
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

async function getShiftTimes(shiftId: string): Promise<ShiftTimes> {
  const prefix = `FMS_SHIFT_${shiftId}`;
  const [start, end, lunchStart, lunchEnd, teaStart, teaEnd] = await Promise.all([
    getSetting(`${prefix}_START`),
    getSetting(`${prefix}_END`),
    getSetting(`${prefix}_LUNCH_START`),
    getSetting(`${prefix}_LUNCH_END`),
    getSetting(`${prefix}_TEA_START`),
    getSetting(`${prefix}_TEA_END`),
  ]);
  return {
    start: start ?? "09:00",
    end: end ?? "18:00",
    lunchStart: lunchStart ?? "13:00",
    lunchEnd: lunchEnd ?? "13:30",
    teaStart: teaStart ?? "",
    teaEnd: teaEnd ?? "",
  };
}

/** Splits a shift's open hours into working windows with lunch (and tea, if configured)
 * cut out — generic over any number of breaks, not hardcoded to exactly two. */
function buildShiftWindows(shift: ShiftTimes): DayWindow[] {
  const start = parseHHMM(shift.start);
  const end = parseHHMM(shift.end);
  if (start === null || end === null || end <= start) return [];

  const breaks = [
    { start: parseHHMM(shift.lunchStart), end: parseHHMM(shift.lunchEnd) },
    { start: parseHHMM(shift.teaStart), end: parseHHMM(shift.teaEnd) },
  ]
    .filter(
      (b): b is { start: number; end: number } =>
        b.start !== null && b.end !== null && b.end > b.start
    )
    .sort((a, b) => a.start - b.start);

  const windows: DayWindow[] = [];
  let cursor = start;
  for (const b of breaks) {
    const breakStart = Math.max(b.start, start);
    const breakEnd = Math.min(b.end, end);
    if (breakStart >= end) continue;
    if (breakStart > cursor) windows.push({ startMin: cursor, endMin: Math.min(breakStart, end) });
    cursor = Math.max(cursor, breakEnd);
  }
  if (cursor < end) windows.push({ startMin: cursor, endMin: end });
  return windows;
}

async function getWeeklyOffDays(): Promise<Set<number>> {
  const raw = await getSetting("FMS_WEEKLY_OFF_DAYS");
  const days = (raw ?? "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return new Set(days.length > 0 ? days : [0]);
}

interface ResolvedSchedule {
  schedule: WeekSchedule;
  overrides: CalendarOverrides;
  /** A day's normal working minutes on this shift — used to convert a Days-unit TAT. */
  minutesPerDay: number;
}

/**
 * Builds the working-hours picture for one shift: its windows, which weekdays are off by
 * default, and which specific dates were opened back up.
 *
 * `userId`/`department` narrow which week-off overrides apply — pass real values for a
 * step assigned to a specific person, or blank for a flow with no assignee (an empty pair
 * only ever matches an "ALL" override, never a personal or department one, which is
 * exactly the right behaviour for a deadline nobody in particular owns).
 */
async function getWorkingSchedule(
  shiftId: string,
  userId: string,
  department: string
): Promise<ResolvedSchedule> {
  const [shiftTimes, weeklyOffDays, holidayDates, overrideRows] = await Promise.all([
    getShiftTimes(shiftId),
    getWeeklyOffDays(),
    getHolidayDates(),
    listWeekoffOverrides(),
  ]);

  const shiftWindows = buildShiftWindows(shiftTimes);
  const windowsByWeekday: DayWindow[][] = Array.from({ length: 7 }, (_, weekday) =>
    weeklyOffDays.has(weekday) ? [] : shiftWindows
  );

  const workingOverrideDates = new Set(
    overrideRows.filter((o) => overrideAppliesToUser(o, userId, department)).map((o) => o.Date)
  );

  const minutesPerDay =
    shiftWindows.reduce((sum, w) => sum + (w.endMin - w.startMin), 0) || DEFAULT_MINUTES_PER_DAY;

  return {
    schedule: { windowsByWeekday },
    overrides: { holidayDates, workingOverrideDates, overrideWindows: shiftWindows },
    minutesPerDay,
  };
}

async function getUserWorkingSchedule(userId: string): Promise<ResolvedSchedule> {
  const user = await getUserById(userId);
  const shiftId = user?.Shift?.trim() || DEFAULT_SHIFT_ID;
  const department = user?.Department ?? "";
  return getWorkingSchedule(shiftId, userId, department);
}

/** The next instant, at or after `epochMs`, that falls inside this user's working hours. */
export async function computeNextWorkingInstant(userId: string, epochMs: number): Promise<number> {
  const { schedule, overrides } = await getUserWorkingSchedule(userId);
  return pureNextWorkingInstant(epochMs, schedule, overrides);
}

/** A TAT deadline for this user, counting only their real working minutes from
 * `startEpochMs` — shift hours, minus lunch/tea, minus weekly-off/holiday days. */
export async function computeTatDeadline(
  userId: string,
  startEpochMs: number,
  tatValue: number,
  tatUnit: FmsTatUnit
): Promise<number> {
  const { schedule, overrides, minutesPerDay } = await getUserWorkingSchedule(userId);
  const minutes = tatUnit === "Days" ? tatValue * minutesPerDay : tatValue * 60;
  return pureAddWorkingMinutes(startEpochMs, minutes, schedule, overrides);
}

/**
 * The end of this user's working day containing `epochMs` — null if that calendar day has
 * no working windows for them at all (a weekly-off/holiday with no override). Lets a
 * dashboard decide when a step completed today should stop showing as "today's" and roll
 * into history instead, without duplicating the shift/holiday/week-off resolution that
 * computeTatDeadline already does.
 */
export async function computeUserDayEnd(userId: string, epochMs: number): Promise<number | null> {
  const { schedule, overrides } = await getUserWorkingSchedule(userId);
  return pureEndOfWorkingDay(epochMs, schedule, overrides);
}

/**
 * A TAT deadline for a flow step nobody in particular is assigned to — e.g. Inward's IQC
 * check, which any user holding the IQC_CHECK grant can pick up. Uses the company's
 * default shift (Shift 1) rather than any one person's, and only an "ALL" week-off
 * override can move it — a personal or department override would make no sense here.
 */
export async function computeDefaultTatDeadline(
  startEpochMs: number,
  tatValue: number,
  tatUnit: FmsTatUnit
): Promise<number> {
  const { schedule, overrides, minutesPerDay } = await getWorkingSchedule(
    DEFAULT_SHIFT_ID,
    "",
    ""
  );
  const minutes = tatUnit === "Days" ? tatValue * minutesPerDay : tatValue * 60;
  return pureAddWorkingMinutes(startEpochMs, minutes, schedule, overrides);
}
