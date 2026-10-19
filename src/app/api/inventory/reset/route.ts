import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { resetAllInventoryData } from "@/lib/inventory/reset";

/**
 * Wipes every Item (every category, including Finished Goods) and every Stock_Ledger
 * movement for the org — see src/lib/inventory/reset.ts. Admin-only: a bigger blast
 * radius than any existing per-item action INVENTORY_SETUP already has, same reasoning
 * as /api/fms/reset.
 */
export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const result = await resetAllInventoryData();
  return NextResponse.json(result);
}
