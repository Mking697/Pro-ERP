import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getOrderTmsDetail } from "@/lib/tms/tms";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;
  const detail = await getOrderTmsDetail(orderId);
  if (!detail) {
    return NextResponse.json({ error: "Order nahi mila." }, { status: 404 });
  }
  return NextResponse.json(detail);
}
