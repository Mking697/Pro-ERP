import type { TaskRecord } from "@/lib/tasks";
import type { FmsRunRecord } from "@/lib/fms/engine";
import { isFmsStepOverdue } from "@/lib/fms/engine";
import { parseStamp } from "@/lib/timestamp";

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
 * (or an FMS step — see fmsMisCounts) go past its date without finishing costs a full
 * mark. Because every penalty is between 0 and 1 per evaluated item, the total can never
 * exceed the count — so the score cannot go past -100% by construction, with no clamp to
 * enforce it.
 */
const ON_TIME_PENALTY = 0;
const DELAY_PENALTY = 0.5;
const NOT_DONE_PENALTY = 1;

export interface MisCounts {
  onTime: number;
  delay: number;
  notDone: number;
}

/** The one place the penalty formula actually runs — both computeMisSummary (Tasks alone)
 * and computeCombinedMisSummary (Tasks + FMS) build a MisCounts and hand it here, so the
 * two can never drift into computing a score two different ways. */
function scoreFromCounts(counts: MisCounts): MisSummary {
  const { onTime, delay, notDone } = counts;
  const totalEvaluated = onTime + delay + notDone;
  const penalty =
    onTime * ON_TIME_PENALTY + delay * DELAY_PENALTY + notDone * NOT_DONE_PENALTY;
  const score =
    totalEvaluated === 0 ? null : -Math.round((penalty / totalEvaluated) * 100);

  return { onTime, delay, notDone, totalEvaluated, penalty, score };
}

function addCounts(a: MisCounts, b: MisCounts): MisCounts {
  return { onTime: a.onTime + b.onTime, delay: a.delay + b.delay, notDone: a.notDone + b.notDone };
}

/** A task counts as "Not Done" (for scoring) only while it's overdue and still pending —
 * this is a live, timestamp-derived classification, never a status stored in the sheet. */
export function isOverdue(task: TaskRecord): boolean {
  if (task.Status !== "Pending" || !task.Due_Date) return false;
  const due = parseStamp(task.Due_Date);
  return due !== null && new Date() > due;
}

function taskMisCounts(tasks: TaskRecord[]): MisCounts {
  let onTime = 0;
  let delay = 0;
  let notDone = 0;

  for (const task of tasks) {
    onTime += Number(task.On_Time_Count || 0);
    delay += Number(task.Delay_Count || 0);
    if (isOverdue(task)) notDone += 1;
  }

  return { onTime, delay, notDone };
}

/**
 * FMS's counterpart to taskMisCounts. Unlike Tasks (which store cumulative On_Time_Count/
 * Delay_Count columns because a recurring task used to roll one row forward), every
 * FMS_RUNS row is already exactly one occurrence, so its own Status is read directly —
 * "On Time" / "Delay Done" are written once, at completion, by completeFmsStep().
 */
export function fmsMisCounts(runs: FmsRunRecord[]): MisCounts {
  let onTime = 0;
  let delay = 0;
  let notDone = 0;

  for (const run of runs) {
    if (run.Status === "On Time") onTime += 1;
    else if (run.Status === "Delay Done") delay += 1;
    else if (isFmsStepOverdue(run)) notDone += 1;
  }

  return { onTime, delay, notDone };
}

export function computeMisSummary(tasks: TaskRecord[]): MisSummary {
  return scoreFromCounts(taskMisCounts(tasks));
}

/** The one score a person actually sees — Tasks and FMS steps both count toward the same
 * number, so "my score" means everything they're accountable for, not just Tasks. Used
 * everywhere a user's MIS score is shown (Dashboard, Performance, the Performance
 * report/export) so it can never read differently in two places. */
export function computeCombinedMisSummary(
  tasks: TaskRecord[],
  fmsRuns: FmsRunRecord[]
): MisSummary {
  return scoreFromCounts(addCounts(taskMisCounts(tasks), fmsMisCounts(fmsRuns)));
}

/** 0 is best, -100 worst — so the thresholds run the other way from a credit score. */
export function getScoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  // -700 (not the more common -600) because this text sits at 14px/font-semibold in some
  // callers (e.g. the Performance table) — -600 measures ~3.2-3.8:1 on white, under WCAG
  // 1.4.3's 4.5:1 floor for normal-size text; -700 clears it (~5:1+) without needing a
  // per-caller "is this large text" carve-out.
  if (score >= -20) return "text-emerald-700 dark:text-emerald-400";
  if (score >= -50) return "text-amber-700 dark:text-amber-400";
  return "text-destructive";
}

/** e.g. "-40%", or "0%" for a clean record. Always signed so the scale reads correctly. */
export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return `${score}%`;
}

export type MisOutcome = "On Time" | "Delay Done" | "Not Done";

export interface MisRow {
  /** Stable key for a list — a task's own ID plus outcome, or an FMS run's Run_ID. */
  id: string;
  source: "task" | "fms";
  /** Task title, or "Step Name — Flow Name" for an FMS row. */
  label: string;
  /** Due date (task) or the step's own deadline/completion stamp (FMS) — raw, rendered
   * with formatDueDisplay by the caller. */
  when: string;
  outcome: MisOutcome;
  /** How many evaluated units this row contributes to the denominator. */
  evaluated: number;
  /** Penalty caused, out of `evaluated`. 0 means this row cost nothing. */
  penalty: number;
  /** Plain-language reason the row scored what it did. */
  reason: string;
}

/**
 * Explains a score instead of just stating it: one row per task or FMS step that actually
 * moved the number, with the credit it earned and why.
 *
 * A recurring task can carry both an on-time and a delayed completion in its counters, so
 * a single task may produce two rows.
 */
export function computeMisBreakdown(
  tasks: TaskRecord[],
  fmsRuns: FmsRunRecord[] = []
): MisRow[] {
  const rows: MisRow[] = [];

  for (const task of tasks) {
    const onTime = Number(task.On_Time_Count || 0);
    const delay = Number(task.Delay_Count || 0);

    if (onTime > 0) {
      rows.push({
        id: `${task.Task_ID}-on-time`,
        source: "task",
        label: task.Title,
        when: task.Due_Date,
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
        id: `${task.Task_ID}-delay`,
        source: "task",
        label: task.Title,
        when: task.Due_Date,
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
        id: `${task.Task_ID}-not-done`,
        source: "task",
        label: task.Title,
        when: task.Due_Date,
        outcome: "Not Done",
        evaluated: 1,
        penalty: NOT_DONE_PENALTY,
        reason: "Due date nikal chuki hai aur task abhi bhi pending hai — poori penalty.",
      });
    }
  }

  for (const run of fmsRuns) {
    const label = `${run.Step_Name} — ${run.Template_Name}`;
    if (run.Status === "On Time") {
      rows.push({
        id: `${run.Run_ID}-on-time`,
        source: "fms",
        label,
        when: run.Completed_At,
        outcome: "On Time",
        evaluated: 1,
        penalty: ON_TIME_PENALTY,
        reason: "Deadline se pehle complete hua — koi penalty nahi.",
      });
    } else if (run.Status === "Delay Done") {
      rows.push({
        id: `${run.Run_ID}-delay`,
        source: "fms",
        label,
        when: run.Completed_At,
        outcome: "Delay Done",
        evaluated: 1,
        penalty: DELAY_PENALTY,
        reason: "Deadline ke baad complete hua — aadhi penalty.",
      });
    } else if (isFmsStepOverdue(run)) {
      rows.push({
        id: `${run.Run_ID}-not-done`,
        source: "fms",
        label,
        when: run.TAT_Deadline,
        outcome: "Not Done",
        evaluated: 1,
        penalty: NOT_DONE_PENALTY,
        reason: "Deadline nikal chuki hai aur step abhi bhi pending hai — poori penalty.",
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
