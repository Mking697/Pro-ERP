import { listActiveRecurringTasks } from "@/lib/recurringTasks";
import { getHolidayDates } from "@/lib/holidays";
import { listTasks, createRecurringOccurrence } from "@/lib/tasks";
import { todayIST } from "@/lib/dateUtil";
import { getSetting } from "@/lib/settings";
import { getTenantOrgId } from "@/lib/tenant";
import { resolveActiveAssigneeWithAudit } from "@/lib/leave/reassignment";
import { runInTenantTransaction } from "@/db/client";
import { insertRecord } from "@/db/repo";
import { leaveReassignments } from "@/db/schema";
import { generateId } from "@/lib/id";

/** True for a Postgres unique-violation (23505) against the given constraint name — same
 * local helper this codebase's other retry-on-collision call sites duplicate (see
 * payables.ts's isUniqueViolation doc comment for why it isn't shared). Walks the error's
 * own `cause` chain since drizzle-orm wraps the real driver error. */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown } | null)?.cause) {
    if (typeof current !== "object" || current === null) continue;
    const e = current as { code?: unknown; constraint?: unknown; message?: unknown };
    if (e.code === "23505") {
      if (typeof e.constraint === "string") return e.constraint === constraintName;
      return typeof e.message === "string" && e.message.includes(constraintName);
    }
  }
  return false;
}

/** DB-enforced occurrence identity: (org, Recurring_ID, Natural_Cycle_Start_Date)
 * for new known cycles, plus the existing (org, Recurring_ID, Due_Date) same-day guard.
 * Historical rows with unknown natural dates are exempt from the natural-key index;
 * due_date is not used to fabricate a natural identity. Two racing cron runs that
 * pass the in-memory check are caught by these unique indexes; either named collision
 * is an idempotent "already generated" signal, not an error.
 *
 * The occurrence's own insert and its leave_reassignments audit row (when the doer is
 * currently mid-leave and this occurrence is therefore born on the buddy) run inside one
 * `runInTenantTransaction` — so a crash between the two never leaves a Task reassigned
 * to a buddy with no audit trail revertLeave() can find, same atomicity guarantee
 * activateLeave()/revertLeave() themselves give existing work. */
async function createOccurrenceIdempotently(orgId: string, input: {
  recurringId: string;
  title: string;
  originalDoerId: string;
  assignedTo: string;
  assignedBy: string;
  frequency: string;
  dueDate: string;
  naturalCycleStartDate: string;
  leaveId: string;
}): Promise<boolean> {
  try {
    await runInTenantTransaction(orgId, async () => {
      const task = await createRecurringOccurrence({
        recurringId: input.recurringId,
        title: input.title,
        assignedTo: input.assignedTo,
        assignedBy: input.assignedBy,
        frequency: input.frequency,
        dueDate: input.dueDate,
        naturalCycleStartDate: input.naturalCycleStartDate,
      });
      if (input.leaveId) {
        await insertRecord(leaveReassignments, {
          id: generateId("LRA"),
          orgId,
          leaveId: input.leaveId,
          entityType: "TASK",
          entityId: task.Task_ID,
          originalAssignee: input.originalDoerId,
          buddyId: input.assignedTo,
        });
      }
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error, "tasks_org_id_recurring_id_due_date_unique")) return false;
    // Catches a missed cycle carried forward to a DIFFERENT calendar day than an earlier
    // attempt already used — see tasks.naturalCycleStartDate's own column comment in
    // src/db/schema/tasks.ts for why the due_date-keyed constraint above can't catch this
    // case on its own.
    if (isUniqueViolation(error, "tasks_org_id_recurring_id_natural_cycle_unique")) return false;
    throw error;
  }
}

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
  /** A rule's cycle for today had already been generated by a concurrent/retried run of
   * this same job before this call's own insert landed — caught by the DB's
   * tasks_org_id_recurring_id_due_date_unique constraint, not by the in-memory check
   * above (which both racing calls can pass). Not an error: the occurrence exists
   * exactly once either way. */
  duplicatesSkipped: number;
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
 *
 * Each occurrence's Assigned_To is resolved against *live* leave state at the moment of
 * creation (see src/lib/leave/reassignment.ts's resolveActiveAssignee), not just
 * Doer_ID verbatim — a rule's doer who is currently mid-leave gets this occurrence born
 * already on their buddy, instead of on an absent doer until the next leave-transition
 * run catches up (and activateLeave() never catches it at all, since it only redirects
 * work that existed at the moment the leave activated).
 */
export async function generateDueRecurringOccurrences(): Promise<GenerateResult> {
  const today = todayIST();
  const orgId = await getTenantOrgId();
  const [rules, holidays, existingTasks, weeklyOffDays] = await Promise.all([
    listActiveRecurringTasks(),
    getHolidayDates(),
    listTasks(),
    getWeeklyOffDays(),
  ]);

  const todayIsNonWorking = holidays.has(today) || weeklyOffDays.has(dayOfWeek(today));

  let created = 0;
  let skippedNonWorkingDay = 0;
  let duplicatesSkipped = 0;

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

      const { assignedTo, leaveId } = await resolveActiveAssigneeWithAudit(orgId, rule.Doer_ID);
      const createdNow = await createOccurrenceIdempotently(orgId, {
        recurringId: rule.Recurring_ID,
        title: rule.Task,
        originalDoerId: rule.Doer_ID,
        assignedTo,
        assignedBy: rule.Assigned_By,
        frequency: rule.Frequency,
        dueDate: `${today}T23:59`,
        naturalCycleStartDate: today,
        leaveId,
      });
      if (createdNow) created += 1;
      else duplicatesSkipped += 1;
      continue;
    }

    // Non-daily: find the most recent cycle this rule owes (which may be in the past, if
    // its natural day landed on a non-working day), and skip only if that cycle has
    // already produced a task — on time or shifted, either way it's fulfilled.
    const naturalDay = findMostRecentScheduledDay(rule.Frequency, rule.Assign_Date, today);
    if (naturalDay === null) continue; // nothing due yet, or rule hasn't started

    // Known identities are authoritative. For unknown legacy rows ONLY, retain the
    // old conservative due-date heuristic; this is not a reconstruction of naturalDay
    // and is never persisted as one. Historical cross-day duplicates remain unknown.
    const alreadyGenerated = existingTasks.some(
      (t) => t.Recurring_ID === rule.Recurring_ID && (
        t.Natural_Cycle_Start_Date
          ? t.Natural_Cycle_Start_Date === naturalDay
          : t.Due_Date.slice(0, 10) >= naturalDay
      )
    );
    if (alreadyGenerated) continue;

    if (todayIsNonWorking) {
      // Today can't host it either — leave the cycle open for a later working day's run.
      skippedNonWorkingDay += 1;
      continue;
    }

    const { assignedTo, leaveId } = await resolveActiveAssigneeWithAudit(orgId, rule.Doer_ID);
    const createdNow = await createOccurrenceIdempotently(orgId, {
      recurringId: rule.Recurring_ID,
      title: rule.Task,
      originalDoerId: rule.Doer_ID,
      assignedTo,
      assignedBy: rule.Assigned_By,
      frequency: rule.Frequency,
      dueDate: `${today}T23:59`,
      naturalCycleStartDate: naturalDay,
      leaveId,
    });
    if (createdNow) created += 1;
    else duplicatesSkipped += 1;
  }

  return { created, skippedNonWorkingDay, duplicatesSkipped };
}
