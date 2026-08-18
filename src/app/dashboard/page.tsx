import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { listTasks } from "@/lib/tasks";
import { computeMisSummary, isOverdue, getScoreColorClass } from "@/lib/mis";
import { DELEGATOR_ROLES, IQC_ROLES } from "@/lib/roles";
import { priorityVariant } from "@/lib/priority";
import { formatDueDisplay } from "@/lib/formatDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LogoutButton from "./logout-button";
import IqcWidget from "./iqc-widget";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    redirect("/login");
  }

  const allTasks = await listTasks();
  const myTasks = allTasks.filter((t) => t.Assigned_To === session.userId);
  const pending = myTasks.filter((t) => t.Status === "Pending");
  const completed = myTasks.filter((t) => t.Status !== "Pending");
  const mis = computeMisSummary(myTasks);

  const upcoming = [...pending]
    .sort((a, b) => (a.Due_Date || "9999").localeCompare(b.Due_Date || "9999"))
    .slice(0, 5);

  const canDelegate = DELEGATOR_ROLES.includes(session.role as (typeof DELEGATOR_ROLES)[number]);
  const canVerifyIqc = IQC_ROLES.includes(session.role as (typeof IQC_ROLES)[number]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Namaste, {session.fullName}</h1>
          <Badge variant="secondary" className="mt-2">
            {session.role}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href="/tasks">Tasks</Link>} />
          <Button variant="outline" render={<Link href="/inward">Inward</Link>} />
          {canDelegate && (
            <Button variant="outline" render={<Link href="/performance">Performance</Link>} />
          )}
          {session.role === "Admin" && (
            <>
              <Button variant="outline" render={<Link href="/admin/users">Users</Link>} />
              <Button variant="outline" render={<Link href="/admin/settings">Settings</Link>} />
            </>
          )}
          <LogoutButton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{pending.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Completed Tasks</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{completed.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">MIS Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-semibold ${getScoreColorClass(mis.score)}`}>
              {mis.score === null ? "—" : `${mis.score}%`}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              On Time: {mis.onTime} · Delay: {mis.delay} · Not Done: {mis.notDone}
            </p>
          </CardContent>
        </Card>
      </div>

      {canVerifyIqc && <IqcWidget />}

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Tasks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 && (
            <p className="text-sm text-muted-foreground">Koi pending task nahi hai.</p>
          )}
          {upcoming.map((task) => (
            <div
              key={task.Task_ID}
              className="flex items-center justify-between rounded-lg border p-3 text-sm"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{task.Title}</p>
                  <Badge variant={priorityVariant(task.Priority)}>{task.Priority || "—"}</Badge>
                </div>
                <p className="text-muted-foreground">
                  Completion: {formatDueDisplay(task.Due_Date)}
                  {task.Task_Type === "Recurring" && ` (${task.Recurrence_Frequency})`}
                </p>
                {task.Attachment_URL && (
                  <a
                    href={task.Attachment_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    View Attachment
                  </a>
                )}
              </div>
              {isOverdue(task) ? (
                <Badge variant="destructive">Overdue</Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" render={<Link href="/tasks">Saare tasks dekhein</Link>} />
        </CardContent>
      </Card>
    </div>
  );
}
