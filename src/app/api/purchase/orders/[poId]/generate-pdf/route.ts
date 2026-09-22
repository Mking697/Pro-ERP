import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { generatePoPdf, PurchaseOrderError } from "@/lib/purchase/orders";

/**
 * (Re)generates a system-formatted PDF for an ALREADY issued PO and overwrites its
 * attachmentUrl — e.g. to replace a manually uploaded scan with a proper document, or to
 * reprint one. See its sibling, POST /api/purchase/orders/generate-pdf (no poId — no PO
 * exists yet at that point), for the pre-Issue draft version used by the PO Issue screen.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const { poId } = await params;

  try {
    const { url } = await generatePoPdf(poId);
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof PurchaseOrderError || err instanceof Error ? err.message : "PDF nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
