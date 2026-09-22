import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createDirectOrder, listOrders, OrderError, type OrderStatus } from "@/lib/orders/orders";

const STATUSES: OrderStatus[] = [
  "Items_Pending",
  "Payment_Review",
  "Credit_Hold",
  "Stock_Check",
  "Dispatch_Pending",
  "Ready_For_PDI",
  "Cancelled",
];

export async function GET(request: Request) {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as OrderStatus) ? (statusParam as OrderStatus) : undefined;

  const orders = await listOrders(status);
  return NextResponse.json({ orders });
}

const newCustomerSchema = z.object({
  customerName: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  gstin: z.string().trim().optional(),
  billingAddress: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
});

const itemSchema = z.object({
  sku: z.string().trim().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
});

const bodySchema = z
  .object({
    customerId: z.string().trim().optional(),
    newCustomer: newCustomerSchema.optional(),
    items: z.array(itemSchema).min(1, "Kam se kam ek item chunein."),
    poAttachmentUrl: z.string().trim().optional(),
    transportArrangedBy: z.enum(["Self", "Party"]),
  })
  .refine((v) => v.customerId || v.newCustomer, {
    message: "Ek Customer chunein ya naya Customer ka naam bharein.",
  });

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
    const order = await createDirectOrder(
      {
        customerId: parsed.data.customerId,
        newCustomer: parsed.data.newCustomer,
        items: parsed.data.items,
        poAttachmentUrl: parsed.data.poAttachmentUrl,
        transportArrangedBy: parsed.data.transportArrangedBy,
      },
      guard.session.userId
    );
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Order ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
