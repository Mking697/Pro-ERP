import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { createQuotation, listQuotationsForLead, QuotationError } from "@/lib/leads/quotations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { leadId } = await params;
  const quotations = await listQuotationsForLead(leadId);
  return NextResponse.json({ quotations });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { leadId } = await params;

  try {
    const quotation = await createQuotation(leadId, guard.session.userId);
    return NextResponse.json({ quotation });
  } catch (err) {
    const message =
      err instanceof QuotationError || err instanceof Error ? err.message : "Quotation ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
