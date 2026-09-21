import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { QuotationError, renderQuotationPdf } from "@/lib/leads/quotations";

/** Renders the quotation PDF fresh, uploads it to Blob, and returns its (public) URL —
 * the frontend just opens that URL in a new tab, same pattern as every other Blob-stored
 * attachment in this app (PO attachments, task proofs, ...). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ quotationId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { quotationId } = await params;

  try {
    const { url } = await renderQuotationPdf(quotationId);
    return NextResponse.json({ url });
  } catch (err) {
    const message =
      err instanceof QuotationError || err instanceof Error ? err.message : "PDF nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
