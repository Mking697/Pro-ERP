import type { TaskRecord } from "@/lib/tasks";
import type { SheetUser } from "@/lib/auth/users";
import type { FmsRunRecord } from "@/lib/fms/engine";
import { computeCombinedMisSummary, isOverdue, type MisSummary } from "@/lib/mis";
import {
  endOfIstDay,
  istDayKey,
  parseStamp,
  shiftIstDays,
  startOfIstDay,
} from "@/lib/timestamp";

/**
 * Date filtering and aggregation for the analytics dashboard.
 *
 * Kept out of the page so the same numbers back the charts, the table and the export —
 * a figure a person reads on screen and a figure they download must never be computed
 * two different ways.
 */

export const RANGE_PRESETS = [
  { key: "today", label: "Aaj" },
  { key: "week", label: "Is hafte" },
  { key: "month", label: "Is mahine" },
  { key: "year", label: "Is saal" },
  { key: "all", label: "Sab" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";

export interface DateRange {
  from: Date;
  to: Date;
  key: RangeKey;
  label: string;
}

/**
 * Turns a preset (or an explicit from/to) into a concrete window.
 *
 * Every boundary is an **IST** day boundary, not a server-local one. `setHours(0,0,0,0)`
 * asks the process's own timezone, which is UTC on Vercel — so "Aaj" began at 5:30am IST
 * and silently dropped everything anybody did before breakfast, while quietly including
 * the small hours of the next morning. The timestamps being filtered are all IST, so the
 * window has to be too.
 *
 * An unparseable custom date falls back to "all" rather than to an empty window —
 * showing nothing looks identical to having no data, which sends people hunting for a
 * problem that does not exist.
 */
export function resolveRange(key: string, from?: string, to?: string): DateRange {
  const now = new Date();
  const today = istDayKey(now);
  const endOfToday = endOfIstDay(today);

  if (key === "custom" && from && to) {
    const f = parseStamp(from);
    const t = parseStamp(to);
    if (f && t) {
      return {
        from: startOfIstDay(f),
        to: endOfIstDay(t),
        key: "custom",
        label: `${from} se ${to}`,
      };
    }
  }

  switch (key) {
    case "today":
      return { from: startOfIstDay(today), to: endOfToday, key: "today", label: "Aaj" };
    case "week":
      return {
        from: shiftIstDays(now, -6),
        to: endOfToday,
        key: "week",
        label: "Pichle 7 din",
      };
    case "month":
      return {
        from: shiftIstDays(now, -29),
        to: endOfToday,
        key: "month",
        label: "Pichle 30 din",
      };
    case "year": {
      // A calendar year back, not 365 days — "Pichle 1 saal" means the same date last
      // year. A 29 February rolls forward to 1 March rather than failing to parse.
      const [y, m, d] = today.split("-");
      return {
        from: startOfIstDay(`${Number(y) - 1}-${m}-${d}`),
        to: endOfToday,
        key: "year",
        label: "Pichle 1 saal",
      };
    }
    default:
      return { from: new Date(0), to: endOfToday, key: "all", label: "Sab" };
  }
}

export function inRange(value: string | undefined, range: DateRange): boolean {
  if (!value) return false;
  // Through parseStamp, never `new Date` — sheets now hold DD/MM/YYYY HH:MM:SS, which
  // `new Date` cannot read. Left as it was, every report would quietly filter its whole
  // data set away and show "no data in this period".
  const parsed = parseStamp(value);
  if (!parsed) return false;
  const t = parsed.getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

/**
 * A task belongs to the window by when it was created, so a task both assigned and
 * completed inside the window is counted once and consistently — not once for each.
 */
export function filterTasks(tasks: TaskRecord[], range: DateRange): TaskRecord[] {
  if (range.key === "all") return tasks;
  return tasks.filter((t) => inRange(t.Created_At, range));
}

export function filterFmsRuns(runs: FmsRunRecord[], range: DateRange): FmsRunRecord[] {
  if (range.key === "all") return runs;
  return runs.filter((r) => inRange(r.Created_At, range));
}

export interface Bucket {
  label: string;
  value: number;
}

/**
 * Which bar an instant belongs in — decided in IST, for the same reason the range is.
 *
 * `toISOString().slice(0, 10)` is the UTC day, so an entry made at 2am IST was drawn on
 * the previous day's bar while the row itself displayed today's date. A chart that
 * disagrees with the table beside it is worse than no chart.
 */
function bucketKey(d: Date, grain: "day" | "week" | "month"): string {
  const day = istDayKey(d);
  if (grain === "month") return day.slice(0, 7);
  if (grain === "week") {
    // Weekday of that IST calendar date, read as UTC so no local timezone can shift it.
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return istDayKey(shiftIstDays(d, -weekday));
  }
  return day;
}

function bucketLabel(key: string, grain: "day" | "week" | "month"): string {
  // Both branches build a UTC instant and read it back in UTC, so the label always names
  // the same calendar date the key does, whatever timezone the server runs in.
  if (grain === "month") {
    const [y, m] = key.split("-");
    return new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  }
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Picks a grain that keeps the axis readable rather than emitting 365 daily points. */
export function bucketByDate(isoDates: string[], range: DateRange): Bucket[] {
  const dates = isoDates
    .map((s) => parseStamp(s))
    .filter((d): d is Date => d !== null);
  if (dates.length === 0) return [];

  const from = range.key === "all" ? new Date(Math.min(...dates.map((d) => d.getTime()))) : range.from;
  const spanDays = Math.max(1, (range.to.getTime() - from.getTime()) / 86_400_000);
  const grain: "day" | "week" | "month" =
    spanDays <= 31 ? "day" : spanDays <= 200 ? "week" : "month";

  const counts = new Map<string, number>();
  for (const d of dates) {
    const k = bucketKey(d, grain);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ label: bucketLabel(k, grain), value: v }));
}

export interface UserScoreRow {
  userId: string;
  name: string;
  role: string;
  department: string;
  summary: MisSummary;
}

/** One row per active user, worst score first — the people who need attention. FMS runs
 * are optional (an org that hasn't connected FMS yet just gets a Task-only score). */
export function perUserScores(
  users: SheetUser[],
  tasks: TaskRecord[],
  fmsRuns: FmsRunRecord[] = []
): UserScoreRow[] {
  return users
    .filter((u) => u.Status === "Active")
    .map((u) => ({
      userId: u.User_ID,
      name: u.Full_Name,
      role: u.Role,
      department: u.Department,
      summary: computeCombinedMisSummary(
        tasks.filter((t) => t.Assigned_To === u.User_ID),
        fmsRuns.filter((r) => r.Assigned_To === u.User_ID)
      ),
    }))
    .sort((a, b) => (a.summary.score ?? 1) - (b.summary.score ?? 1));
}

export interface TaskTotals {
  total: number;
  pending: number;
  completed: number;
  overdue: number;
  onTime: number;
  delay: number;
}

export function taskTotals(tasks: TaskRecord[]): TaskTotals {
  const pending = tasks.filter((t) => t.Status === "Pending");
  return {
    total: tasks.length,
    pending: pending.length,
    completed: tasks.filter((t) => t.Status !== "Pending").length,
    overdue: pending.filter(isOverdue).length,
    onTime: tasks.reduce((n, t) => n + Number(t.On_Time_Count || 0), 0),
    delay: tasks.reduce((n, t) => n + Number(t.Delay_Count || 0), 0),
  };
}

/** Counts by an arbitrary key, biggest first, with a capped tail folded into "Other". */
export function countBy<T>(
  items: T[],
  key: (item: T) => string,
  limit = 6
): Bucket[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item) || "—";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length <= limit) {
    return sorted.map(([label, value]) => ({ label, value }));
  }

  // Never invent a colour for a long tail — fold it, as the palette rules require.
  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1).reduce((n, [, v]) => n + v, 0);
  return [...head.map(([label, value]) => ({ label, value })), { label: "Other", value: rest }];
}
