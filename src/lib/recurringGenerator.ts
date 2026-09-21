import { listActiveRecurringTasks } from "@/lib/recurringTasks";
import { getHolidayDates } from "@/lib/holidays";
import { listTasks, createRecurringOccurrence } from "@/lib/tasks";
import { todayIST } from "@/lib/dateUtil";
import { getSetting } from "@/lib/settings";

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to = new Date(`${toISO}T00:00:00Z`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function monthsBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T00:00:00Z`);
  const to = new Date(`${toISO}T00:00:00Z`);
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeek(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

/** Same setting FMS's own working-hours calendar reads (src/lib/fms/calendar.ts's
 * getWeeklyOffDays) — Sunday (0) is the default when nothing's configured. Duplicated
 * rather than imported: calendar.ts pulls in the whole FMS module graph (shifts, users,
 * week-off overrides) that this file — plain Tasks, no FMS involved — has no other need of. */
async function getWeeklyOffDays(): Promise<Set<number>> {
  const raw = await getSetting("FMS_WEEKLY_OFF_DAYS");
  const days = (raw ?? "0")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return new Set(days.length > 0 ? days : [0]);
}

/** True when `today` is `stepMonths` (or a multiple of it) after `assignISO`, on the same
 * day-of-month — or, if the assign day doesn't exist in today's month (e.g. the 31st assigned
 * against a 30-day month, or Feb 29 in a non-leap year), on that month's last day instead, so
 * the cycle isn't silently skipped. Used for Monthly (1), Quarterly (3), and Yearly (12). */
function isMonthlyStepMatch(assignISO: string, todayISO: string, stepMonths: number): boolean {
  const monthsDiff = monthsBetween(assignISO, todayISO);
  if (monthsDiff < 0 || monthsDiff % stepMonths !== 0) return false;

  const assign = new Date(`${assignISO}T00:00:00Z`);
  const today = new Date(`${todayISO}T00:00:00Z`);
  const assignDay = assign.getUTCDate();
  const todayDay = today.getUTCDate();
  const todayMonthLength = daysInMonth(today.getUTCFullYear(), today.getUTCMonth());

  if (todayDay === assignDay) return true;
  return todayDay === todayMonthLength && assignDay > todayMonthLength;
}

function isScheduledToday(frequency: string, assignISO: string, todayISO: string): boolean {
  const diffDays = daysBetween(assignISO, todayISO);
  if (diffDays < 0) return false; // hasn't started yet

  switch (frequency) {
    case "D":
      return true;
    case "W":
      return diffDays % 7 === 0;
    case "15D":
      return diffDays % 15 === 0;
    case "M":
      return isMonthlyStepMatch(assignISO, todayISO, 1);
    case "Q":
      return isMonthlyStepMatch(assignISO, todayISO, 3);
    case "Y":
      return isMonthlyStepMatch(assignISO, todayISO, 12);
    default:
      return false;
  }
}

/** How far back a non-Daily rule's missed natural day can still be found and shifted
 * forward — generous margins, but each stays short of the frequency's own step length so
 * this never reaches back into the *previous* already-fulfilled cycle. */
const LOOKBACK_DAYS: Record<string, number> = {
  W: 6,
  "15D": 14,
  M: 27,
  Q: 85,
  Y: 360,
};

/** The most recent date on or before `todayISO` that this rule's schedule actually falls
 * on, or null if none exists within its lookback window (or the rule hasn't started yet). */
function findMostRecentScheduledDay(
  frequency: string,
  assignISO: string,
  todayISO: string
): string | null {
  const lookback = LOOKBACK_DAYS[frequency] ?? 0;
  for (let i = 0; i <= lookback; i++) {
    const candidate = addDaysISO(todayISO, -i);
    if (isScheduledToday(frequency, assignISO, candidate)) return candidate;
  }
  return null;
}

export interface GenerateResult {
  created: number;
  /** A rule was due but today is a holiday or the weekly-off day, so nothing was
   * generated for it today — for Daily that cycle is simply skipped (tomorrow is its own
   * fresh day); for every other frequency the cycle stays open and a later working day's
   * run will generate it then (see findMostRecentScheduledDay). */
  skippedNonWorkingDay: number;
}

/**
 * Runs once a day (Vercel Cron): for every active Recurring_Tasks rule whose schedule says
 * today is due, appends one new Tasks row.
 *
 * Holidays and the weekly-off day (Settings' FMS_WEEKLY_OFF_DAYS, Sunday by default) are
 * both non-working days. A Daily rule simply produces nothing on a non-working day — the
 * very next working day is its own new cycle, nothing to catch up on. Every other
 * frequency (W/15D/M/Q/Y) would otherwise lose an entire cycle if its one due day happened
 * to land on a non-working day, so those instead carry the missed cycle forward and
 * generate it on the next working day — see findMostRecentScheduledDay.
 */
export async function generateDueRecurringOccurrences(): Promise<GenerateResult> {
  const today = todayIST();
  const [rules, holidays, existingTasks, weeklyOffDays] = await Promise.all([
    listActiveRecurringTasks(),
    getHolidayDates(),
    listTasks(),
    getWeeklyOffDays(),
  ]);

  const todayIsNonWorking = holidays.has(today) || weeklyOffDays.has(dayOfWeek(today));

  let created = 0;
  let skippedNonWorkingDay = 0;

  for (const rule of rules) {
    if (rule.Frequency === "D") {
      if (!isScheduledToday("D", rule.Assign_Date, today)) continue;

      if (todayIsNonWorking) {
        skippedNonWorkingDay += 1;
        continue;
      }

      const alreadyToday = existingTasks.some(
        (t) => t.Recurring_ID === rule.Recurring_ID && t.Due_Date.startsWith(today)
      );
      if (alreadyToday) continue;

      await createRecurringOccurrence({
        recurringId: rule.Recurring_ID,
        title: rule.Task,
        assignedTo: rule.Doer_ID,
        assignedBy: rule.Assigned_By,
        frequency: rule.Frequency,
        dueDate: `${today}T23:59`,
      });
      created += 1;
      continue;
    }

    // Non-daily: find the most recent cycle this rule owes (which may be in the past, if
    // its natural day landed on a non-working day), and skip only if that cycle has
    // already produced a task — on time or shifted, either way it's fulfilled.
    const naturalDay = findMostRecentScheduledDay(rule.Frequency, rule.Assign_Date, today);
    if (naturalDay === null) continue; // nothing due yet, or rule hasn't started

    const alreadyGenerated = existingTasks.some(
      (t) => t.Recurring_ID === rule.Recurring_ID && t.Due_Date.slice(0, 10) >= naturalDay
    );
    if (alreadyGenerated) continue;

    if (todayIsNonWorking) {
      // Today can't host it either — leave the cycle open for a later working day's run.
      skippedNonWorkingDay += 1;
      continue;
    }

    await createRecurringOccurrence({
      recurringId: rule.Recurring_ID,
      title: rule.Task,
      assignedTo: rule.Doer_ID,
      assignedBy: rule.Assigned_By,
      frequency: rule.Frequency,
      dueDate: `${today}T23:59`,
    });
    created += 1;
  }

  return { created, skippedNonWorkingDay };
}
