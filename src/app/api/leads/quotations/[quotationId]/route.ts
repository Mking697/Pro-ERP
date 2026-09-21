import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import {
  acceptQuotation,
  getQuotation,
  QuotationError,
  rejectQuotation,
  saveQuotationHeader,
  saveQuotationItems,
  sendQuotation,
} from "@/lib/leads/quotations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ quotationId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { quotationId } = await params;
  const quotation = await getQuotation(quotationId);
  if (!quotation) {
    return NextResponse.json({ error: "Quotation nahi mila." }, { status: 404 });
  }
  return NextResponse.json({ quotation });
}

const itemSchema = z.object({
  particular: z.string().trim().optional().default(""),
  specification: z.string().trim().optional().default(""),
  description: z.string().trim().optional().default(""),
  uom: z.string().trim().optional().default(""),
  qtyFormula: z.string().trim().optional().default(""),
  qty: z.coerce.number().nonnegative().default(0),
  rate: z.coerce.number().nonnegative().default(0),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("header"),
    partyName: z.string().trim().min(1).optional(),
    contactPerson: z.string().trim().optional(),
    customerMobile: z.string().trim().optional(),
    customerEmail: z.string().trim().optional(),
    customerGst: z.string().trim().optional(),
    billingAddress: z.string().trim().optional(),
    billingCity: z.string().trim().optional(),
    billingState: z.string().trim().optional(),
    billingPincode: z.string().trim().optional(),
    shippingPartyName: z.string().trim().optional(),
    shippingContactPerson: z.string().trim().optional(),
    shippingAddress: z.string().trim().optional(),
    shippingCity: z.string().trim().optional(),
    shippingState: z.string().trim().optional(),
    shippingPincode: z.string().trim().optional(),
    subject: z.string().trim().optional(),
    note: z.string().trim().optional(),
    terms: z.string().optional(),
    validUntil: z.string().optional(),
  }),
  z.object({
    action: z.literal("items"),
    items: z.array(itemSchema).max(200),
    freightAmount: z.coerce.number().nonnegative().default(0),
    gstPercent: z.coerce.number().min(0).max(100),
  }),
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().optional() }),
  z.object({ action: z.literal("accept") }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ quotationId: string }> }
) {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const { quotationId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action." },
      { status: 400 }
    );
  }

  const actorId = guard.session.userId;

  try {
    switch (parsed.data.action) {
      case "header": {
        const { action, ...input } = parsed.data;
        void action;
        const quotation = await saveQuotationHeader(quotationId, input);
        return NextResponse.json({ quotation });
      }
      case "items": {
        const quotation = await saveQuotationItems(quotationId, parsed.data.items, {
          freightAmount: parsed.data.freightAmount,
          gstPercent: parsed.data.gstPercent,
        });
        return NextResponse.json({ quotation });
      }
      case "send": {
        const quotation = await sendQuotation(quotationId, actorId);
        return NextResponse.json({ quotation });
      }
      case "reject": {
        const quotation = await rejectQuotation(quotationId, actorId, parsed.data.reason);
        return NextResponse.json({ quotation });
      }
      case "accept": {
        const quotation = await acceptQuotation(quotationId, actorId);
        return NextResponse.json({ quotation });
      }
    }
  } catch (err) {
    const message =
      err instanceof QuotationError || err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
