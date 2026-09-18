import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listFmsHistory } from "@/lib/fms/history";

/**
 * Anyone signed in can see their own FMS history — same tier as their own pending steps.
 * PERFORMANCE_VIEW additionally sees everyone's, matching who can already see the
 * team-wide MIS breakdown at /performance.
 */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const rows = await listFmsHistory();

  const scoped = guard.session.access.includes("PERFORMANCE_VIEW")
    ? rows
    : rows.filter((r) => r.assignedTo === guard.session.userId);

  return NextResponse.json({ history: scoped });
}
