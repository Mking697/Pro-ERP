import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { confirmResolved, reopenRequest, MaintenanceError } from "@/lib/maintenance/maintenance";

/**
 * The reporter's own confirmation — the only thing that resumes a Paused Production
 * Line step. requireSession() only: confirmResolved()/reopenRequest() themselves check
 * `existing.reportedBy === actorId`, so a non-Maintenance line operator (who may hold no
 * module grant at all) can still confirm their own breakdown.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { requestId } = await params;
  const body = await request.json().catch(() => null);
  const outcome = typeof body?.outcome === "string" ? body.outcome : "confirm";
  const remark = typeof body?.remark === "string" ? body.remark : undefined;

  try {
    if (outcome === "reopen") {
      const updated = await reopenRequest({ requestId, actorId: guard.session.userId, remark });
      return NextResponse.json({ request: updated });
    }
    const updated = await confirmResolved({ requestId, actorId: guard.session.userId, remark });
    return NextResponse.json({ request: updated });
  } catch (err) {
    const message = err instanceof MaintenanceError || err instanceof Error ? err.message : "Confirm nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
