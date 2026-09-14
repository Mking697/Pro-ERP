import { requireModule } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";
import { listTasks } from "@/lib/tasks";
import { listAllFmsRuns } from "@/lib/fms/engine";
import { tryModule } from "@/lib/moduleSheets";
import { NextResponse } from "next/server";
import { resolveRange, filterTasks, filterFmsRuns, perUserScores } from "@/lib/analytics";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

export async function GET(request: Request) {
  const guard = await requireModule("PERFORMANCE_VIEW");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const range = resolveRange(
    url.searchParams.get("range") ?? "all",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined
  );

  const [allTasks, allFmsRuns, users] = await Promise.all([
    tryModule(() => listTasks()),
    tryModule(() => listAllFmsRuns()),
    listUsers(),
  ]);

  const rows = perUserScores(
    users,
    filterTasks(allTasks ?? [], range),
    filterFmsRuns(allFmsRuns ?? [], range)
  );

  const csv = buildCsv([
    ["Name", "Role", "Department", "On Time", "Delay Done", "Not Done", "Evaluated", "Score %"],
    ...rows.map((r) => [
      r.name,
      r.role,
      r.department,
      r.summary.onTime,
      r.summary.delay,
      r.summary.notDone,
      r.summary.totalEvaluated,
      r.summary.score ?? "",
    ]),
  ]);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: csvResponseHeaders(`performance-${range.key}-${stamp}.csv`),
  });
}
