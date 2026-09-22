import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listInspections, type PdiStatus } from "@/lib/pdi/pdi";

const STATUSES: PdiStatus[] = ["Pending", "Passed"];

export async function GET(request: Request) {
  const guard = await requireModule("PDI_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as PdiStatus) ? (statusParam as PdiStatus) : undefined;

  const inspections = await listInspections(status);
  return NextResponse.json({ inspections });
}
