import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { previewPoPdf, PurchaseOrderError } from "@/lib/purchase/orders";

const lineSchema = z.object({
  indentId: z.string().trim().min(1),
  newPrice: z.coerce.number().nonnegative().optional(),
});

const bodySchema = z.object({
  vendorId: z.string().trim().min(1, "Vendor chunein."),
  lines: z.array(lineSchema).min(1, "Kam se kam ek item chunein."),
});

/**
 * Renders a DRAFT PO PDF from the purchaser's current vendor+line selection on the PO Issue
 * screen, before any `purchase_orders` row exists — see previewPoPdf()'s own doc comment.
 * The frontend drops the resulting URL straight into the same attachmentUrl slot a manual
 * upload would fill, then still has to click "PO Issue karein" to actually create the PO.
 */
export async function POST(request: Request) {
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

  try {
    const { url } = await previewPoPdf({ vendorId: parsed.data.vendorId, lines: parsed.data.lines });
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof PurchaseOrderError || err instanceof Error ? err.message : "PDF nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
