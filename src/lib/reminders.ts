import { listTasks, type TaskRecord } from "@/lib/tasks";
import { listUsers } from "@/lib/auth/users";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
import { isOverdue } from "@/lib/mis";

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
