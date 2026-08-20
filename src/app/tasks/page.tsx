import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import TaskBoard from "./task-board";
import PageHeader from "@/components/page-header";

export default async function TasksPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title="Tasks"
          description="Apne tasks dekhein aur, agar authorized hain, naye tasks assign karein."
        />
        <TaskBoard currentUserId={session.userId} />
      </div>
    </AppShell>
  );
}
