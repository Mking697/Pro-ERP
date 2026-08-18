import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { listUsers } from "@/lib/auth/users";
import { listTasks } from "@/lib/tasks";
import { computeMisSummary, getScoreColorClass } from "@/lib/mis";
import { DELEGATOR_ROLES } from "@/lib/roles";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function PerformancePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!DELEGATOR_ROLES.includes(session.role as (typeof DELEGATOR_ROLES)[number])) {
    redirect("/dashboard");
  }

  const [users, allTasks] = await Promise.all([listUsers(), listTasks()]);

  const rows = users
    .filter((u) => u.Status === "Active")
    .map((u) => {
      const summary = computeMisSummary(allTasks.filter((t) => t.Assigned_To === u.User_ID));
      return { user: u, summary };
    })
    .sort((a, b) => (b.summary.score ?? -1) - (a.summary.score ?? -1));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Team Performance</h1>
        <p className="text-muted-foreground">MIS score, timestamps ke hisaab se dynamically calculate hota hai.</p>
      </div>

      <div className="rounded-lg border">
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
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Koi active user nahi mila.
                </TableCell>
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
                  {summary.score === null ? "—" : `${summary.score}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
