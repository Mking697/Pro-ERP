import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listFullyShipped } from "@/lib/tms/tms";

export async function GET() {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const orders = await listFullyShipped();
  return NextResponse.json({ orders });
}
