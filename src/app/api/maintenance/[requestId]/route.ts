import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import {
  assignMaintenanceRequest,
  markFixedByMaintenance,
  closeStandaloneRequest,
  cancelRequest,
  getMaintenanceRequest,
  MaintenanceError,
} from "@/lib/maintenance/maintenance";

/**
 * Maintenance-side actions on one request — assign to self/someone, mark fixed, close a
 * standalone (non-Breakdown) log, or cancel. All MAINTENANCE_FMS-gated: these are the
 * Maintenance team's own moves, distinct from confirm/reopen which only the original
 * reporter may do (see [requestId]/confirm and [requestId]/reopen).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const guard = await requireModule("MAINTENANCE_FMS");
  if (!guard.ok) return guard.response;

  const { requestId } = await params;
  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";

  try {
    if (action === "assign") {
      const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo : guard.session.userId;
      const updated = await assignMaintenanceRequest(requestId, assignedTo, guard.session.userId);
      return NextResponse.json({ request: updated });
    }

    if (action === "fixed") {
      const existing = await getMaintenanceRequest(requestId);
      if (!existing) throw new MaintenanceError("Request nahi mili.");
      if (existing.kind === "Breakdown") {
        const updated = await markFixedByMaintenance({
          requestId,
          fixedBy: guard.session.userId,
          remark: typeof body?.remark === "string" ? body.remark : undefined,
        });
        return NextResponse.json({ request: updated });
      }
      // Standalone kinds close directly — no reporter confirmation needed.
      const updated = await closeStandaloneRequest({
        requestId,
        actorId: guard.session.userId,
        remark: typeof body?.remark === "string" ? body.remark : undefined,
      });
      return NextResponse.json({ request: updated });
    }

    if (action === "cancel") {
      const updated = await cancelRequest(requestId, guard.session.userId);
      return NextResponse.json({ request: updated });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    const message = err instanceof MaintenanceError || err instanceof Error ? err.message : "Kaam nahi hua.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
