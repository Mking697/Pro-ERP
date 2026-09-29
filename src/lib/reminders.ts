import { listTasks, type TaskRecord } from "@/lib/tasks";
import { listUsers } from "@/lib/auth/users";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
import { isOverdue, computeCombinedMisSummary, computeMisBreakdown, formatScore } from "@/lib/mis";
import { listAllFmsRuns } from "@/lib/fms/engine";
import { filterTasks, filterFmsRuns, type DateRange } from "@/lib/analytics";

export interface ReminderResult {
  sent: number;
  failed: number;
}

/** Sends every active user with pending tasks one WhatsApp message listing all of them. */
export async function sendPendingTaskReminders(): Promise<ReminderResult> {
  const [tasks, users] = await Promise.all([listTasks(), listUsers()]);
  const userMap = new Map(users.map((u) => [u.User_ID, u]));

  const pendingByUser = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (task.Status !== "Pending") continue;
    const list = pendingByUser.get(task.Assigned_To) ?? [];
    list.push(task);
    pendingByUser.set(task.Assigned_To, list);
  }

  let sent = 0;
  let failed = 0;

  for (const [userId, userTasks] of pendingByUser) {
    const user = userMap.get(userId);
    if (!user || user.Status !== "Active" || !user.Phone_Number) continue;

    const lines = userTasks.map((t) => {
      const overdue = isOverdue(t) ? " (OVERDUE)" : "";
      return `• ${t.Title} — due ${t.Due_Date || "—"}${overdue}`;
    });
    const message = `Namaste ${user.Full_Name}, aapke ${userTasks.length} pending task(s) hain:\n${lines.join("\n")}`;

    const result = await sendWhatsAppMessage(user.Phone_Number, message);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return { sent, failed };
}

export interface PerformanceReportResult {
  sent: number;
  failed: number;
  /** No phone on file, or nothing evaluated for them yet in this range — neither is a
   * send failure, both are just nothing to send. */
  skipped: number;
}

/** Sends every active, evaluated user their own MIS score + task/step breakdown over
 * WhatsApp — the Team Performance page's "Send Report" action. One message per person,
 * each carrying only their own data (never another user's), mirroring the same
 * `computeMisBreakdown()` the on-screen dialog and `/dashboard`'s own score breakdown use,
 * so the WhatsApp text can never disagree with what a click on their name would show. */
export async function sendPerformanceReports(range: DateRange): Promise<PerformanceReportResult> {
  const [tasks, fmsRuns, users] = await Promise.all([
    listTasks(),
    listAllFmsRuns(),
    listUsers(),
  ]);
  const rangedTasks = filterTasks(tasks, range);
  const rangedFmsRuns = filterFmsRuns(fmsRuns, range);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const user of users) {
    if (user.Status !== "Active") continue;
    if (!user.Phone_Number) {
      skipped += 1;
      continue;
    }

    const userTasks = rangedTasks.filter((t) => t.Assigned_To === user.User_ID);
    const userFmsRuns = rangedFmsRuns.filter((r) => r.Assigned_To === user.User_ID);
    const summary = computeCombinedMisSummary(userTasks, userFmsRuns);
    if (summary.score === null) {
      skipped += 1;
      continue;
    }

    const breakdown = computeMisBreakdown(userTasks, userFmsRuns);
    const lines = breakdown
      .slice(0, 20)
      .map((r) => `• ${r.label} — ${r.outcome}${r.reason ? ` (${r.reason})` : ""}`);
    const message = [
      `Namaste ${user.Full_Name}, aapka MIS score: ${formatScore(summary.score)} hai.`,
      `On Time: ${summary.onTime}, Delay: ${summary.delay}, Not Done: ${summary.notDone}.`,
      "",
      "Breakdown:",
      ...lines,
    ].join("\n");

    const result = await sendWhatsAppMessage(user.Phone_Number, message);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return { sent, failed, skipped };
}
