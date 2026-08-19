import type { TaskRecord } from "@/lib/tasks";

export interface MisSummary {
  onTime: number;
  delay: number;
  notDone: number;
  totalEvaluated: number;
  /** 0-100, or null when there's nothing to evaluate yet. */
  score: number | null;
}

// On-time counts full credit, a late-but-done task counts half, an overdue-and-still-pending
// task counts zero. Tune here if the business wants a different weighting later.
const ON_TIME_WEIGHT = 1;
const DELAY_WEIGHT = 0.5;

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
  const score =
    totalEvaluated === 0
      ? null
      : Math.round(((onTime * ON_TIME_WEIGHT + delay * DELAY_WEIGHT) / totalEvaluated) * 100);

  return { onTime, delay, notDone, totalEvaluated, score };
}

export function getScoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

export type MisOutcome = "On Time" | "Delay Done" | "Not Done";

export interface MisRow {
  task: TaskRecord;
  outcome: MisOutcome;
  /** How many evaluated units this row contributes to the denominator. */
  evaluated: number;
  /** Weighted credit earned, out of `evaluated`. */
  points: number;
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
        points: onTime * ON_TIME_WEIGHT,
        reason:
          onTime === 1
            ? "Due date se pehle complete hua — poora credit."
            : `${onTime} baar due date se pehle complete hua — poora credit.`,
      });
    }

    if (delay > 0) {
      rows.push({
        task,
        outcome: "Delay Done",
        evaluated: delay,
        points: delay * DELAY_WEIGHT,
        reason:
          delay === 1
            ? "Due date ke baad complete hua — aadha credit."
            : `${delay} baar due date ke baad complete hua — aadha credit.`,
      });
    }

    if (isOverdue(task)) {
      rows.push({
        task,
        outcome: "Not Done",
        evaluated: 1,
        points: 0,
        reason: "Due date nikal chuki hai aur task abhi bhi pending hai — zero credit.",
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
