import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { GeneralPurchaseOrderError, jobCostingForPlan } from "@/lib/purchase/generalOrders";

export async function GET(request: Request) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const planId = url.searchParams.get("planId")?.trim();
  if (!planId) {
    return NextResponse.json({ error: "planId zaroori hai." }, { status: 400 });
  }

  try {
    const report = await jobCostingForPlan(planId);
    return NextResponse.json({ report });
  } catch (err) {
    const message =
      err instanceof GeneralPurchaseOrderError || err instanceof Error
        ? err.message
        : "Job costing load nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
