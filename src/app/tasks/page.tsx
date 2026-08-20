import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import TaskBoard from "./task-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

export default async function TasksPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Tasks")}
          description={t("Apne tasks dekhein aur, agar authorized hain, naye tasks assign karein.")}
        />
        <TaskBoard currentUserId={session.userId} />
      </div>
    </AppShell>
  );
}
