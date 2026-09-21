import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createWalkInQuotation, listAllQuotations, QuotationError } from "@/lib/leads/quotations";

/** Every quotation for the org — lead-linked and walk-in — for the /leads "Quotations" tab. */
export async function GET() {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const quotations = await listAllQuotations();
  return NextResponse.json({ quotations });
}

const bodySchema = z.object({
  customerId: z.string().trim().optional(),
  newCustomer: z
    .object({
      customerName: z.string().trim().min(1, "Customer ka naam zaroori hai."),
      phone: z.string().trim().optional(),
      email: z.string().trim().optional(),
      gstin: z.string().trim().optional(),
      billingAddress: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().optional(),
    })
    .optional(),
});

/** A walk-in quotation — no lead behind it, either against an existing Customer Master row
 * or a brand-new one added on the spot. */
export async function POST(request: Request) {
  const guard = await requireModule("LEAD_FMS");
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
    const quotation = await createWalkInQuotation(parsed.data, guard.session.userId);
    return NextResponse.json({ quotation });
  } catch (err) {
    const message =
      err instanceof QuotationError || err instanceof Error ? err.message : "Quotation ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
