import type { TaskRecord } from "@/lib/tasks";
import type { SheetUser } from "@/lib/auth/users";
import { computeMisSummary, isOverdue, type MisSummary } from "@/lib/mis";

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

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/**
 * Turns a preset (or an explicit from/to) into a concrete window.
 *
 * An unparseable custom date falls back to "all" rather than to an empty window —
 * showing nothing looks identical to having no data, which sends people hunting for a
 * problem that does not exist.
 */
export function resolveRange(key: string, from?: string, to?: string): DateRange {
  const now = new Date();

  if (key === "custom" && from && to) {
    const f = new Date(from);
    const t = new Date(to);
    if (!Number.isNaN(f.getTime()) && !Number.isNaN(t.getTime())) {
      return {
        from: startOfDay(f),
        to: endOfDay(t),
        key: "custom",
        label: `${from} se ${to}`,
      };
    }
  }

  switch (key) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now), key: "today", label: "Aaj" };
    case "week": {
      const f = startOfDay(now);
      f.setDate(f.getDate() - 6);
      return { from: f, to: endOfDay(now), key: "week", label: "Pichle 7 din" };
    }
    case "month": {
      const f = startOfDay(now);
      f.setDate(f.getDate() - 29);
      return { from: f, to: endOfDay(now), key: "month", label: "Pichle 30 din" };
    }
    case "year": {
      const f = startOfDay(now);
      f.setFullYear(f.getFullYear() - 1);
      return { from: f, to: endOfDay(now), key: "year", label: "Pichle 1 saal" };
    }
    default:
      return { from: new Date(0), to: endOfDay(now), key: "all", label: "Sab" };
  }
}

export function inRange(iso: string | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
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

export interface Bucket {
  label: string;
  value: number;
}

function bucketKey(d: Date, grain: "day" | "week" | "month"): string {
  if (grain === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (grain === "week") {
    const c = new Date(d);
    c.setDate(c.getDate() - c.getDay());
    return c.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function bucketLabel(key: string, grain: "day" | "week" | "month"): string {
  if (grain === "month") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    });
  }
  return new Date(key).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Picks a grain that keeps the axis readable rather than emitting 365 daily points. */
export function bucketByDate(isoDates: string[], range: DateRange): Bucket[] {
  const dates = isoDates
    .map((s) => new Date(s))
    .filter((d) => !Number.isNaN(d.getTime()));
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

/** One row per active user, worst score first — the people who need attention. */
export function perUserScores(
  users: SheetUser[],
  tasks: TaskRecord[]
): UserScoreRow[] {
  return users
    .filter((u) => u.Status === "Active")
    .map((u) => ({
      userId: u.User_ID,
      name: u.Full_Name,
      role: u.Role,
      department: u.Department,
      summary: computeMisSummary(tasks.filter((t) => t.Assigned_To === u.User_ID)),
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
