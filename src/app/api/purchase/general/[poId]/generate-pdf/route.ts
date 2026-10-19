import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { generateGeneralPoPdf, GeneralPurchaseOrderError } from "@/lib/purchase/generalOrders";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const { poId } = await params;
  try {
    const { url } = await generateGeneralPoPdf(poId);
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof GeneralPurchaseOrderError || err instanceof Error
        ? err.message
        : "PDF generate nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
