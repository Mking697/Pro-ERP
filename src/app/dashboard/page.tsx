import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { listTasks } from "@/lib/tasks";
import { tryModule } from "@/lib/moduleSheets";
import { MODULE_ACCESS } from "@/lib/moduleAccess";
import SetupRequired from "@/components/setup-required";
import AppShell from "@/components/app-shell";
import { computeMisSummary, isOverdue, getScoreColorClass, formatScore } from "@/lib/mis";
import { priorityVariant } from "@/lib/priority";
import { formatDueDisplay } from "@/lib/formatDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TaskBoard from "@/app/tasks/task-board";
import InwardBoard from "@/app/inward/inward-board";
import ScoreBreakdown from "./score-breakdown";
import Analytics from "./analytics";

function StatCard({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Tabular figures keep the cards' numbers optically aligned. */}
        <div className={`text-3xl font-semibold tabular-nums ${valueClassName ?? ""}`}>
          {value}
        </div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    redirect("/login");
  }

  // A freshly signed-up organization has no Tasks sheet yet — that is an onboarding
  // step still pending, not an error worth showing a crash page for.
  const allTasks = await tryModule(() => listTasks());
  if (allTasks === null) {
    return (
      <AppShell session={session}>
        <SetupRequired what="Tasks" isAdmin={session.role === "Admin"} />
      </AppShell>
    );
  }

  const myTasks = allTasks.filter((t) => t.Assigned_To === session.userId);
  const pending = myTasks.filter((t) => t.Status === "Pending");
  const completed = myTasks.filter((t) => t.Status !== "Pending");
  const mis = computeMisSummary(myTasks);
  const overdueCount = pending.filter(isOverdue).length;

  const upcoming = [...pending]
    .sort((a, b) => (a.Due_Date || "9999").localeCompare(b.Due_Date || "9999"))
    .slice(0, 5);

  const canVerifyIqc = session.access.includes("IQC_CHECK");
  const showInward =
    session.access.includes("INWARD_ENTRY") ||
    canVerifyIqc ||
    session.access.includes("IMS_VIEW");

  // Whatever an Admin granted this person shows up here as somewhere they can go.
  const myModules = MODULE_ACCESS.filter((m) => session.access.includes(m.key));

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Namaste, {session.fullName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending.length === 0
              ? "Aapke paas koi pending task nahi hai."
              : `${pending.length} task pending${overdueCount > 0 ? `, ${overdueCount} overdue` : ""}.`}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Pending Tasks" value={String(pending.length)} />
          <StatCard label="Completed Tasks" value={String(completed.length)} />
          <StatCard
            label="MIS Score"
            value={formatScore(mis.score)}
            valueClassName={getScoreColorClass(mis.score)}
            hint={`On Time ${mis.onTime} · Delay ${mis.delay} · Not Done ${mis.notDone} — 0% best`}
          />
        </div>

        {/*
          Tabs are built from this person's own grants: a plain doer sees Overview,
          Tasks and Performance, while someone who also holds Inward/IQC/IMS gets that
          work in the same place instead of having to know another URL exists.
        */}
        <Tabs defaultValue={one("tab") ?? "overview"}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Dashboard</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            {showInward && <TabsTrigger value="inward">Inward &amp; IQC</TabsTrigger>}
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-6">
            {myModules.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Aapke modules</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {myModules.map((m) => (
                    <Link
                      key={m.key}
                      href={m.href}
                      className="rounded-lg border p-3 transition-colors duration-150 hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <p className="text-sm font-medium">{m.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {m.description}
                      </p>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Kaise use karein</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Guidebook me sirf wahi steps hain jo aapke access se jude hain.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/guide">Guidebook kholein</Link>}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming Tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {upcoming.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Koi pending task nahi hai.
                  </p>
                )}
                {upcoming.map((task) => (
                  <div
                    key={task.Task_ID}
                    className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm transition-colors duration-150 hover:bg-muted/50"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{task.Title}</p>
                        <Badge variant={priorityVariant(task.Priority)}>
                          {task.Priority || "—"}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">
                        Completion: {formatDueDisplay(task.Due_Date)}
                        {task.Task_Type === "Recurring" &&
                          ` (${task.Recurrence_Frequency})`}
                      </p>
                      {task.Attachment_URL && (
                        <a
                          href={task.Attachment_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-primary underline underline-offset-2"
                        >
                          View Attachment
                        </a>
                      )}
                    </div>
                    {isOverdue(task) ? (
                      <Badge variant="destructive" className="shrink-0">
                        Overdue
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        Pending
                      </Badge>
                    )}
                  </div>
                ))}
                {upcoming.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link href="/tasks">Saare tasks dekhein</Link>}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="mt-4">
            <Analytics
              session={session}
              rangeKey={one("range") ?? "month"}
              from={one("from")}
              to={one("to")}
            />
          </TabsContent>

          <TabsContent value="tasks" className="mt-4">
            <TaskBoard currentUserId={session.userId} />
          </TabsContent>

          {showInward && (
            <TabsContent value="inward" className="mt-4">
              <InwardBoard canVerify={canVerifyIqc} />
            </TabsContent>
          )}

          <TabsContent value="performance" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Aapka score kaise bana</CardTitle>
              </CardHeader>
              <CardContent>
                <ScoreBreakdown tasks={myTasks} summary={mis} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
