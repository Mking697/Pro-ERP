import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createOrderFromQuotation, OrderError } from "@/lib/orders/orders";

const newCustomerSchema = z.object({
  customerName: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  gstin: z.string().trim().optional(),
  billingAddress: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
});

const bodySchema = z
  .object({
    quotationId: z.string().trim().min(1),
    items: z
      .array(z.object({ lineNo: z.string().trim().min(1), sku: z.string().trim().min(1) }))
      .min(1, "Kam se kam ek line map karein."),
    customerId: z.string().trim().optional(),
    newCustomer: newCustomerSchema.optional(),
    poAttachmentUrl: z.string().trim().optional(),
    transportArrangedBy: z.enum(["Self", "Party"]),
  })
  .refine((v) => v.customerId || v.newCustomer, {
    message: "Ek Customer chunein ya naya Customer ka naam bharein.",
  });

/** Step 1 for a Lead-sourced candidate — item mapping + customer confirm + order creation,
 * all in one atomic action (see src/lib/orders/orders.ts's createOrderFromQuotation). */
export async function POST(request: Request) {
  const guard = await requireModule("ORDER_FMS");
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
    const order = await createOrderFromQuotation(parsed.data, guard.session.userId);
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Order ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
