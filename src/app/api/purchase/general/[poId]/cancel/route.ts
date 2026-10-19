import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { cancelGeneralPurchaseOrder, GeneralPurchaseOrderError } from "@/lib/purchase/generalOrders";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const { poId } = await params;
  try {
    const order = await cancelGeneralPurchaseOrder(poId);
    return NextResponse.json({ order });
  } catch (err) {
    const message =
      err instanceof GeneralPurchaseOrderError || err instanceof Error
        ? err.message
        : "Cancel nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
