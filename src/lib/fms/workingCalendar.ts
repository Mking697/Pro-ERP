/**
 * Working-hours calendar math for FMS turnaround times — pure, zero imports, same shape
 * as src/lib/inventory/allocation.ts. Give it a schedule and a pool of minutes and it
 * tells you when they run out, with no server dependency to fake in a test.
 *
 * Stays IST-correct without importing src/lib/timestamp.ts by carrying the same fixed
 * offset as a literal and reading calendar fields off a shifted epoch — the same trick
 * that file uses, duplicated rather than imported, so this stays a pure function of its
 * arguments.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
// A misconfigured calendar (e.g. every weekday off, no overrides) must fail loudly
// instead of hanging the request forever.
const MAX_DAYS_SCANNED = 3650;

/** Minutes since IST midnight. Breaks (lunch/tea) are expected to already be excluded —
 * this module only ever sees the windows that are actually open for work. */
export interface DayWindow {
  startMin: number;
  endMin: number;
}

export interface WeekSchedule {
  /** Index 0 = Sunday .. 6 = Saturday. An empty array means "not a working day" — a
   * weekly off, unless overridden for this date. */
  windowsByWeekday: DayWindow[][];
}

export interface CalendarOverrides {
  /** "YYYY-MM-DD" — always non-working, regardless of weekday or override. */
  holidayDates: Set<string>;
  /** "YYYY-MM-DD" — a normally-off weekday opened back up on this specific date. */
  workingOverrideDates: Set<string>;
  /** Windows to use on a workingOverrideDates date (the user's normal shift windows). */
  overrideWindows: DayWindow[];
}

function toIst(epochMs: number): number {
  return epochMs + IST_OFFSET_MS;
}

function fromIst(istMs: number): number {
  return istMs - IST_OFFSET_MS;
}

function istDayKey(istMs: number): string {
  const d = new Date(istMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function istWeekday(istMs: number): number {
  return new Date(istMs).getUTCDay();
}

function startOfIstDay(istMs: number): number {
  const d = new Date(istMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function windowsForDate(
  dayKey: string,
  weekday: number,
  schedule: WeekSchedule,
  overrides: CalendarOverrides
): DayWindow[] {
  if (overrides.holidayDates.has(dayKey)) return [];
  const base = schedule.windowsByWeekday[weekday] ?? [];
  if (base.length > 0) return base;
  if (overrides.workingOverrideDates.has(dayKey)) return overrides.overrideWindows;
  return [];
}

function sortedWindows(windows: DayWindow[]): DayWindow[] {
  return [...windows].sort((a, b) => a.startMin - b.startMin);
}

/**
 * Snaps `epochMs` forward to the nearest instant that falls inside a working window —
 * itself, if it's already inside one.
 */
export function nextWorkingInstant(
  epochMs: number,
  schedule: WeekSchedule,
  overrides: CalendarOverrides
): number {
  let istMs = toIst(epochMs);

  for (let day = 0; day < MAX_DAYS_SCANNED; day++) {
    const dayStart = startOfIstDay(istMs);
    const dayKey = istDayKey(istMs);
    const weekday = istWeekday(istMs);
    const windows = sortedWindows(windowsForDate(dayKey, weekday, schedule, overrides));
    const minuteOfDay = Math.floor((istMs - dayStart) / MINUTE_MS);

    for (const w of windows) {
      if (minuteOfDay < w.startMin) {
        return fromIst(dayStart + w.startMin * MINUTE_MS);
      }
      if (minuteOfDay < w.endMin) {
        return fromIst(istMs);
      }
    }

    // Nothing left today — move to the start of the next day and try again.
    istMs = dayStart + DAY_MS;
  }

  throw new Error(
    `nextWorkingInstant: no working day found within ${MAX_DAYS_SCANNED} days — check the calendar configuration.`
  );
}

/**
 * Walks forward from `startEpochMs`, consuming `minutes` of working time only — off-days,
 * holidays and excluded breaks don't count. The start point is snapped to a working
 * instant first.
 */
export function addWorkingMinutes(
  startEpochMs: number,
  minutes: number,
  schedule: WeekSchedule,
  overrides: CalendarOverrides
): number {
  let cursor = nextWorkingInstant(startEpochMs, schedule, overrides);
  let remaining = minutes;

  for (let day = 0; day < MAX_DAYS_SCANNED; day++) {
    const istMs = toIst(cursor);
    const dayStart = startOfIstDay(istMs);
    const dayKey = istDayKey(istMs);
    const weekday = istWeekday(istMs);
    const windows = sortedWindows(windowsForDate(dayKey, weekday, schedule, overrides));
    const minuteOfDay = Math.floor((istMs - dayStart) / MINUTE_MS);

    const current = windows.find((w) => minuteOfDay >= w.startMin && minuteOfDay < w.endMin);
    if (!current) {
      // Cursor landed in a gap between windows (or the calendar changed under us) —
      // snap forward again rather than assume anything about where it is.
      cursor = nextWorkingInstant(cursor, schedule, overrides);
      continue;
    }

    const availableInWindow = current.endMin - minuteOfDay;
    if (remaining <= availableInWindow) {
      return fromIst(dayStart + (minuteOfDay + remaining) * MINUTE_MS);
    }

    remaining -= availableInWindow;
    cursor = nextWorkingInstant(fromIst(dayStart + current.endMin * MINUTE_MS), schedule, overrides);
  }

  throw new Error(
    `addWorkingMinutes: exceeded ${MAX_DAYS_SCANNED} days without consuming the requested minutes — check the calendar configuration.`
  );
}
