import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listPlans } from "@/lib/inventory/plans";

/**
 * Independent PO's "Job" reference picker — every Production Plan, searchable by its own
 * jobNo/productName. Needs only PURCHASE_FMS, not PPC_PLAN — tagging a purchase against a
 * job is a read-only reference, not a planning action.
 */
export async function GET() {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const plans = await listPlans();
  return NextResponse.json({
    plans: plans
      .filter((p) => p.status !== "Cancelled")
      .map((p) => ({
        id: p.planId,
        jobNo: p.jobNo,
        productName: p.productName,
        status: p.status,
        materials: p.materials.map((m) => ({
          sku: m.sku,
          itemName: m.itemName,
          uom: m.uom,
          requiredQty: m.requiredQty,
        })),
      })),
  });
}
