import { requireModule } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";
import { listTasks } from "@/lib/tasks";
import { tryModule } from "@/lib/moduleSheets";
import { NextResponse } from "next/server";
import { resolveRange, filterTasks, perUserScores } from "@/lib/analytics";

/**
 * Escapes one CSV cell — quotes doubled, anything risky wrapped, and a formula defused.
 *
 * Excel and Sheets treat a cell beginning `=`, `+`, `-`, `@`, tab or carriage return as a
 * formula. A person's name and department are typed by an org Admin and land in this file
 * unaltered, so `=cmd|'/c calc'!A1` or a `WEBSERVICE()` call would execute on the machine
 * of whoever opens the download — turning "can edit a user's name" into "can run code on
 * a colleague's laptop". A leading apostrophe marks the cell as text and stops that.
 *
 * Only strings are treated this way. The score column is a genuine negative number and
 * would be ruined by an apostrophe, so numbers are written exactly as they are — a real
 * number can never be a formula.
 */
function cell(value: string | number): string {
  if (typeof value === "number") return String(value);

  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
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
