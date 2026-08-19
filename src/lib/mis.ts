import type { TaskRecord } from "@/lib/tasks";

export interface MisSummary {
  onTime: number;
  delay: number;
  notDone: number;
  totalEvaluated: number;
  /** Penalty points accrued — 0 is spotless. */
  penalty: number;
  /** 0 (best) to -100 (worst), or null when there's nothing to evaluate yet. */
  score: number | null;
}

/**
 * Scoring is a penalty scale: 0% is a clean record, -100% is the worst possible.
 *
 * Finishing on time costs nothing, finishing late costs half a mark, and letting a task
 * go past its date without finishing costs a full mark. Because every penalty is between
 * 0 and 1 per evaluated task, the total can never exceed the count — so the score cannot
 * go past -100% by construction, with no clamp to enforce it.
 */
const ON_TIME_PENALTY = 0;
const DELAY_PENALTY = 0.5;
const NOT_DONE_PENALTY = 1;

/** A task counts as "Not Done" (for scoring) only while it's overdue and still pending —
 * this is a live, timestamp-derived classification, never a status stored in the sheet. */
export function isOverdue(task: TaskRecord): boolean {
  if (task.Status !== "Pending" || !task.Due_Date) return false;
  return new Date() > new Date(task.Due_Date);
}

export function computeMisSummary(tasks: TaskRecord[]): MisSummary {
  let onTime = 0;
  let delay = 0;
  let notDone = 0;

  for (const task of tasks) {
    onTime += Number(task.On_Time_Count || 0);
    delay += Number(task.Delay_Count || 0);
    if (isOverdue(task)) notDone += 1;
  }

  const totalEvaluated = onTime + delay + notDone;
  const penalty =
    onTime * ON_TIME_PENALTY + delay * DELAY_PENALTY + notDone * NOT_DONE_PENALTY;
  const score =
    totalEvaluated === 0 ? null : -Math.round((penalty / totalEvaluated) * 100);

  return { onTime, delay, notDone, totalEvaluated, penalty, score };
}

/** 0 is best, -100 worst — so the thresholds run the other way from a credit score. */
export function getScoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= -20) return "text-emerald-600 dark:text-emerald-400";
  if (score >= -50) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

/** e.g. "-40%", or "0%" for a clean record. Always signed so the scale reads correctly. */
export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return `${score}%`;
}

export type MisOutcome = "On Time" | "Delay Done" | "Not Done";

export interface MisRow {
  task: TaskRecord;
  outcome: MisOutcome;
  /** How many evaluated units this row contributes to the denominator. */
  evaluated: number;
  /** Penalty caused, out of `evaluated`. 0 means this row cost nothing. */
  penalty: number;
  /** Plain-language reason the row scored what it did. */
  reason: string;
}

/**
 * Explains a score instead of just stating it: one row per task that actually moved the
 * number, with the credit it earned and why.
 *
 * A recurring task can carry both an on-time and a delayed completion in its counters,
 * so a single task may produce two rows.
 */
export function computeMisBreakdown(tasks: TaskRecord[]): MisRow[] {
  const rows: MisRow[] = [];

  for (const task of tasks) {
    const onTime = Number(task.On_Time_Count || 0);
    const delay = Number(task.Delay_Count || 0);

    if (onTime > 0) {
      rows.push({
        task,
        outcome: "On Time",
        evaluated: onTime,
        penalty: onTime * ON_TIME_PENALTY,
        reason:
          onTime === 1
            ? "Due date se pehle complete hua — koi penalty nahi."
            : `${onTime} baar due date se pehle complete hua — koi penalty nahi.`,
      });
    }

    if (delay > 0) {
      rows.push({
        task,
        outcome: "Delay Done",
        evaluated: delay,
        penalty: delay * DELAY_PENALTY,
        reason:
          delay === 1
            ? "Due date ke baad complete hua — aadhi penalty."
            : `${delay} baar due date ke baad complete hua — aadhi penalty.`,
      });
    }

    if (isOverdue(task)) {
      rows.push({
        task,
        outcome: "Not Done",
        evaluated: 1,
        penalty: NOT_DONE_PENALTY,
        reason: "Due date nikal chuki hai aur task abhi bhi pending hai — poori penalty.",
      });
    }
  }

  return rows;
}

export function misOutcomeVariant(
  outcome: MisOutcome
): "default" | "secondary" | "destructive" {
  if (outcome === "On Time") return "default";
  if (outcome === "Delay Done") return "secondary";
  return "destructive";
}
