import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import TaskBoard from "./task-board";

export default async function TasksPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-muted-foreground">
          Apne tasks dekhein aur, agar authorized hain, naye tasks assign karein.
        </p>
      </div>
      <TaskBoard currentUserId={session.userId} />
    </div>
  );
}
