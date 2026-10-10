import { NextResponse } from "next/server";
import { getMutationKey, MutationConflictError } from "@/lib/mutations";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { receivePurchaseOrderLine, PurchaseOrderError } from "@/lib/purchase/orders";
import { IndentReceiptError } from "@/lib/inventory/indents";

const bodySchema = z.object({
  indentId: z.string().trim().min(1),
  quantity: z.coerce.number().positive("Received quantity 0 se zyada honi chahiye."),
  invoiceUrl: z.string().trim().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const { poId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const order = await receivePurchaseOrderLine(
      poId,
      parsed.data.indentId,
      parsed.data.quantity,
      guard.session.userId,
      parsed.data.invoiceUrl,
      getMutationKey(request)
    );
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ order: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message =
      err instanceof PurchaseOrderError || err instanceof IndentReceiptError || err instanceof Error
        ? err.message
        : "Receive nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
