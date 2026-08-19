import { requireModule } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";
import { listTasks } from "@/lib/tasks";
import { tryModule } from "@/lib/moduleSheets";
import { NextResponse } from "next/server";
import { resolveRange, filterTasks, perUserScores } from "@/lib/analytics";

/** Escapes one CSV cell — quotes doubled, and anything risky wrapped. */
function cell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const guard = await requireModule("PERFORMANCE_VIEW");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const range = resolveRange(
    url.searchParams.get("range") ?? "all",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined
  );

  const [allTasks, users] = await Promise.all([
    tryModule(() => listTasks()),
    listUsers(),
  ]);

  const rows = perUserScores(users, filterTasks(allTasks ?? [], range));

  const lines = [
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
  ].map((cols) => cols.map(cell).join(","));

  // CRLF and a UTF-8 BOM so Excel opens this cleanly, including non-ASCII names.
  const csv = "﻿" + lines.join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="performance-${range.key}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
