import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import TaskBoard from "./task-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { listTasks } from "@/lib/tasks";
import { listUsers } from "@/lib/auth/users";

export default async function TasksPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");

  // Computed here (server-rendered, same request the page itself needs) rather than left
  // for TaskBoard's own client-side effect to fetch after hydration — mirrors exactly
  // what GET /api/tasks + GET /api/users/directory already compute, so this removes the
  // always-shows-once loading skeleton a client-only fetch used to produce on first paint,
  // without duplicating the access logic (both routes stay in place for every later write).
  const canDelegate = session.access.includes("TASK_DELEGATE");
  const canAssignRecurring = session.access.includes("RECURRING_ASSIGN");

  const [allTasks, allUsers] = await Promise.all([listTasks(), listUsers()]);
  const initialMyTasks = allTasks.filter((task) => task.Assigned_To === session.userId);
  const initialDelegatedTasks = canDelegate
    ? allTasks.filter((task) => task.Assigned_By === session.userId)
    : [];
  const initialUserMap: Record<string, string> = {};
  for (const u of allUsers) {
    if (u.Status === "Active") initialUserMap[u.User_ID] = u.Full_Name;
  }

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Tasks")}
          description={t("Apne tasks dekhein aur, agar authorized hain, naye tasks assign karein.")}
        />
        <TaskBoard
          currentUserId={session.userId}
          initialMyTasks={initialMyTasks}
          initialDelegatedTasks={initialDelegatedTasks}
          initialCanDelegate={canDelegate}
          initialCanAssignRecurring={canAssignRecurring}
          initialUserMap={initialUserMap}
        />
      </div>
    </AppShell>
  );
}
