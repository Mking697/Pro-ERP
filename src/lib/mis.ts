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
