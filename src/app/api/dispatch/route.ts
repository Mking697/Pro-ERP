import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listDispatches, type DispatchStatus } from "@/lib/dispatch/dispatch";

const VALID_STATUSES: readonly DispatchStatus[] = ["In_Transit", "Dispatched", "Delivered"];

/** In-Transit / Dispatched boards — `?status=` optional (mirrors TMS's own
 * /api/tms/shipments). */
export async function GET(request: Request) {
  const guard = await requireModule("DISPATCH_FMS");
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as DispatchStatus)
      ? (statusParam as DispatchStatus)
      : undefined;

  const dispatches = await listDispatches(status);
  return NextResponse.json({ dispatches });
}
