import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { updateCustomer } from "@/lib/parties/customers";

/** Undefined leaves the column untouched; an empty string or explicit null clears it back to
 * "no credit extended" — mirrors the inventory items PATCH route's own `optionalNumber`. */
const optionalCreditNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const patchSchema = z.object({
  customerName: z.string().trim().min(1).optional(),
  contactPerson: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  gstin: z.string().trim().optional(),
  billingAddress: z.string().trim().optional(),
  shippingAddress: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  creditTerms: z.string().trim().optional(),
  creditLimit: optionalCreditNumber,
  creditDays: optionalCreditNumber,
  status: z.enum(["Active", "Inactive"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { customerId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const customer = await updateCustomer(decodeURIComponent(customerId), parsed.data);
    return NextResponse.json({ customer });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Customer update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
