import { listActiveRecurringTasks } from "@/lib/recurringTasks";
import { getHolidayDates } from "@/lib/holidays";
import { listTasks, createRecurringOccurrence } from "@/lib/tasks";
import { todayIST } from "@/lib/dateUtil";

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

export interface GenerateResult {
  created: number;
  skippedHoliday: number;
}

/** Runs once a day (Vercel Cron): for every active Recurring_Tasks rule whose schedule says
 * today is due, appends one new Tasks row — unless today is in the Holiday List, or that
 * occurrence was already generated (idempotent against a re-run/retry the same day). */
export async function generateDueRecurringOccurrences(): Promise<GenerateResult> {
  const today = todayIST();
  const [rules, holidays, existingTasks] = await Promise.all([
    listActiveRecurringTasks(),
    getHolidayDates(),
    listTasks(),
  ]);

  const isHoliday = holidays.has(today);
  const existingByRule = new Set(
    existingTasks
      .filter((t) => t.Recurring_ID && t.Due_Date.startsWith(today))
      .map((t) => t.Recurring_ID)
  );

  let created = 0;
  let skippedHoliday = 0;

  for (const rule of rules) {
    if (!isScheduledToday(rule.Frequency, rule.Assign_Date, today)) continue;

    if (isHoliday) {
      skippedHoliday += 1;
      continue;
    }

    if (existingByRule.has(rule.Recurring_ID)) continue; // already generated today

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

  return { created, skippedHoliday };
}
