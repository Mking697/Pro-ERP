import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getOrder, listOrderActivities, listOrderPayments } from "@/lib/orders/orders";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;
  const order = await getOrder(orderId);
  if (!order) return NextResponse.json({ error: "Order nahi mila." }, { status: 404 });

  const [activities, payments] = await Promise.all([
    listOrderActivities(orderId),
    listOrderPayments(orderId),
  ]);

  return NextResponse.json({ order, activities, payments });
}
