import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getGeneralPurchaseOrder } from "@/lib/purchase/generalOrders";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const { poId } = await params;
  const order = await getGeneralPurchaseOrder(poId);
  if (!order) return NextResponse.json({ error: "PO nahi mila." }, { status: 404 });
  return NextResponse.json({ order });
}
