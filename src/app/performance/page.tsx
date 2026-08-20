import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { listUsers } from "@/lib/auth/users";
import { listTasks } from "@/lib/tasks";
import { tryModule } from "@/lib/moduleSheets";
import SetupRequired from "@/components/setup-required";
import AppShell from "@/components/app-shell";
import { computeMisSummary, getScoreColorClass, formatScore } from "@/lib/mis";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getT } from "@/lib/i18n/server";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/page-header";

export default async function PerformancePage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("PERFORMANCE_VIEW")) {
    redirect("/dashboard");
  }

  const [users, allTasks] = await Promise.all([
    listUsers(),
    tryModule(() => listTasks()),
  ]);
  if (allTasks === null) {
    return (
      <AppShell session={session}>
        <SetupRequired what="Tasks" isAdmin={session.role === "Admin"} />
      </AppShell>
    );
  }

  const rows = users
    .filter((u) => u.Status === "Active")
    .map((u) => {
      const summary = computeMisSummary(allTasks.filter((t) => t.Assigned_To === u.User_ID));
      return { user: u, summary };
    })
    .sort((a, b) => (b.summary.score ?? -1) - (a.summary.score ?? -1));

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Team Performance")}
          description={t(
            "MIS score timestamps se calculate hota hai. 0% sabse achha, −100% sabse kharab — late aur chhoote hue tasks penalty banate hain."
          )}
        >
          {/* Downloads exactly the doer-wise list on screen, through the same
              perUserScores calculation — so the file can never disagree with the page. */}
          <Button
            variant="outline"
            size="sm"
            render={
              <a href="/api/analytics/export?range=all" download>
                <Download />
                {t("Excel export")}
              </a>
            }
          />
        </PageHeader>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-center">On Time</TableHead>
              <TableHead className="text-center">Delay</TableHead>
              <TableHead className="text-center">Not Done</TableHead>
              <TableHead className="text-right">MIS Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">{t("Koi active user nahi mila.")}</TableCell>
              </TableRow>
            )}
            {rows.map(({ user, summary }) => (
              <TableRow key={user.User_ID}>
                <TableCell className="font-medium">{user.Full_Name}</TableCell>
                <TableCell>{user.Role}</TableCell>
                <TableCell className="text-center">{summary.onTime}</TableCell>
                <TableCell className="text-center">{summary.delay}</TableCell>
                <TableCell className="text-center">{summary.notDone}</TableCell>
                <TableCell className={`text-right font-semibold ${getScoreColorClass(summary.score)}`}>
                  {formatScore(summary.score)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    </AppShell>
  );
}
