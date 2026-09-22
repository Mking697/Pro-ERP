import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listShipments, type TmsShipmentStatus } from "@/lib/tms/tms";

const STATUSES: TmsShipmentStatus[] = ["Pending", "At_Loading_Dock"];

export async function GET(request: Request) {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as TmsShipmentStatus)
    ? (statusParam as TmsShipmentStatus)
    : undefined;

  const shipments = await listShipments(status);
  return NextResponse.json({ shipments });
}
