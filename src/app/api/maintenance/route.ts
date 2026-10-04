import { NextResponse } from "next/server";
import { requireModule, requireSession } from "@/lib/auth/guard";
import { listMaintenanceRequests, createStandaloneRequest, MaintenanceError } from "@/lib/maintenance/maintenance";

/**
 * Board list — MAINTENANCE_FMS gated, same as every other module's own GET list route.
 * POST (standalone, non-Breakdown log entry) only needs a session: anyone can report a
 * generator/servicing/wiring/light issue, same as Inward's own "anyone can file" shape —
 * the module grant gates who WORKS the queue, not who may report something broken.
 */
export async function GET() {
  const guard = await requireModule("MAINTENANCE_FMS");
  if (!guard.ok) return guard.response;

  const requests = await listMaintenanceRequests();
  return NextResponse.json({ requests });
}

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const description = typeof body?.description === "string" ? body.description : "";

  try {
    const created = await createStandaloneRequest({
      kind: kind as never,
      description,
      reportedBy: guard.session.userId,
    });
    return NextResponse.json({ request: created });
  } catch (err) {
    const message = err instanceof MaintenanceError || err instanceof Error ? err.message : "Request nahi ban payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
