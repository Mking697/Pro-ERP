import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { reportBreakdown, MaintenanceError } from "@/lib/maintenance/maintenance";

/**
 * The one entry point that pauses a running Production Line step. Uses requireSession(),
 * not requireModule("MAINTENANCE_FMS") — reportBreakdown() itself checks that the caller
 * is the step's own assignee, same "assignee check happens inside the write" reasoning
 * mark-dispatched's own route comment documents. A line operator with no Maintenance
 * grant at all must still be able to report their own step going down.
 */
export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : "";
  const description = typeof body?.description === "string" ? body.description : "";

  if (!runId) {
    return NextResponse.json({ error: "runId zaroori hai." }, { status: 400 });
  }

  try {
    const created = await reportBreakdown({
      runId,
      reportedBy: guard.session.userId,
      description,
    });
    return NextResponse.json({ request: created });
  } catch (err) {
    const message = err instanceof MaintenanceError || err instanceof Error ? err.message : "Breakdown report nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
