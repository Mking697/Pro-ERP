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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ScoreBreakdown from "./score-breakdown";
import { getT } from "@/lib/i18n/server";
import { reportsFor } from "@/lib/reports";

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
  const t = await getT();
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
              ? t("Aapke paas koi pending task nahi hai.")
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
          Two things live here: an overview of your own work, and the way in to the
          reports. The operational boards used to be duplicated as tabs, so Tasks and
          Inward each existed in two places; they stay in the nav where they were already
          reachable, and each one now has a report of its own instead.
        */}
        <Tabs defaultValue={one("tab") ?? "overview"}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">{t("Reports")}</TabsTrigger>
            <TabsTrigger value="performance">{t("Aapka score")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-6">
            {myModules.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("Aapke modules")}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {myModules.map((m) => (
                    <Link
                      key={m.key}
                      href={m.href}
                      className="rounded-lg border p-3 transition-colors duration-150 hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <p className="text-sm font-medium">{t(m.label)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(m.description)}
                      </p>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>{t("Kaise use karein")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Guidebook me sirf wahi steps hain jo aapke access se jude hain.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/guide">{t("Guidebook kholein")}</Link>}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming Tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {upcoming.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("Koi pending task nahi hai.")}</p>
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
                    render={<Link href="/tasks">{t("Saare tasks dekhein")}</Link>}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t(
                "Har module ki apni report. Jo aapke access me hai, wahi yahan dikhta hai — aur har report alag se share ki ja sakti hai."
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {reportsFor(session.access).map((report) => (
                <Card
                  key={report.id}
                  className="transition-colors duration-150 hover:border-foreground/20"
                >
                  <CardHeader>
                    <CardTitle className="text-base">
                      <Link
                        href={`/reports/${report.id}`}
                        className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t(report.label)}
                      </Link>
                    </CardTitle>
                    <CardDescription>{t(report.description)}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="performance" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("Aapka score kaise bana")}</CardTitle>
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
