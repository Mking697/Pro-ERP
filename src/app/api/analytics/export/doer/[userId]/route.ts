import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";
import { listTasks } from "@/lib/tasks";
import { listAllFmsRuns } from "@/lib/fms/engine";
import { resolveRange, filterTasks, filterFmsRuns } from "@/lib/analytics";
import { computeMisBreakdown } from "@/lib/mis";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/** One Doer's own score breakdown — the same rows the "click a name" dialog shows — as a
 * downloadable CSV, for whoever needs it outside the app (a manager keeping their own
 * copy, a payroll-adjacent conversation, etc). Same `PERFORMANCE_VIEW` grant as every other
 * cross-user read on this page; a user's own userId is not exempted from that guard here —
 * this route is reached from the Team Performance table, not from a "my own score" page. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireModule("PERFORMANCE_VIEW");
  if (!guard.ok) return guard.response;

  const { userId } = await params;

  const url = new URL(request.url);
  const range = resolveRange(
    url.searchParams.get("range") ?? "all",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined
  );

  const [users, allTasks, allFmsRuns] = await Promise.all([
    listUsers(),
    listTasks(),
    listAllFmsRuns(),
  ]);
  const user = users.find((u) => u.User_ID === userId);
  if (!user) return NextResponse.json({ error: "User nahi mila." }, { status: 404 });

  const tasks = filterTasks(allTasks, range).filter((t) => t.Assigned_To === userId);
  const fmsRuns = filterFmsRuns(allFmsRuns, range).filter((r) => r.Assigned_To === userId);
  const rows = computeMisBreakdown(tasks, fmsRuns);

  const csv = buildCsv([
    ["Task / Step", "Due / When", "Outcome", "Evaluated", "Penalty", "Reason"],
    ...rows.map((r) => [r.label, r.when, r.outcome, r.evaluated, r.penalty, r.reason]),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = user.Full_Name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new NextResponse(csv, {
    headers: csvResponseHeaders(`performance-${safeName}-${range.key}-${stamp}.csv`),
  });
}
