import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getInspection, listActivities } from "@/lib/pdi/pdi";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pdiId: string }> }
) {
  const guard = await requireModule("PDI_FMS");
  if (!guard.ok) return guard.response;

  const { pdiId } = await params;
  const inspection = await getInspection(pdiId);
  if (!inspection) return NextResponse.json({ error: "PDI inspection nahi mili." }, { status: 404 });

  const activities = await listActivities(pdiId);
  return NextResponse.json({ inspection, activities });
}
