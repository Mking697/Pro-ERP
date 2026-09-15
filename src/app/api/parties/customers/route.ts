import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { createCustomer, listCustomers } from "@/lib/parties/customers";

export async function GET() {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const customers = await tryModule(() => listCustomers());
  return NextResponse.json({
    customers: customers ?? [],
    setupRequired: customers === null ? "Customer Master" : null,
  });
}

const createSchema = z.object({
  customerName: z.string().trim().min(1, "Customer ka naam zaroori hai."),
  contactPerson: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  gstin: z.string().trim().optional().default(""),
  billingAddress: z.string().trim().optional().default(""),
  shippingAddress: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  creditTerms: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const { customer, warning } = await createCustomer({ ...parsed.data, createdBy: guard.session.email });
    return NextResponse.json({ customer, warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Customer ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
