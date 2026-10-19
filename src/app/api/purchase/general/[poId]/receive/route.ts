import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { GeneralPurchaseOrderError, receiveGeneralPurchaseOrder } from "@/lib/purchase/generalOrders";

const bodySchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        receivedQty: z.coerce.number().min(0),
      })
    )
    .min(1, "Kam se kam ek line ki quantity bharein."),
  invoiceUrl: z.string().trim().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { poId } = await params;
  try {
    const order = await receiveGeneralPurchaseOrder(
      poId,
      guard.session.userId,
      parsed.data.lines,
      parsed.data.invoiceUrl
    );
    return NextResponse.json({ order });
  } catch (err) {
    const message =
      err instanceof GeneralPurchaseOrderError || err instanceof Error
        ? err.message
        : "Receive save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
