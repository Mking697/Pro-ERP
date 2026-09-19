import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listPurchaseCandidates } from "@/lib/purchase/orders";

export async function GET() {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const candidates = await listPurchaseCandidates();
  return NextResponse.json({ candidates });
}
