import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getPurchaseSetup } from "@/lib/purchase/settings";

/**
 * A read-only slice of Purchase Setup for the PO Issue screen — just the PO Document
 * Defaults (GST%/Note/Terms & Conditions), not the Doer/TAT config, so anyone holding
 * PURCHASE_FMS (not just an Admin) can pre-fill these before Issue. The full
 * PurchaseSetupConfig stays behind /api/admin/settings/purchase-setup's own Admin-only
 * guard.
 */
export async function GET() {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const setup = await getPurchaseSetup();
  return NextResponse.json({
    gstPercent: setup.gstPercentDefault,
    defaultTerms: setup.defaultTerms,
    defaultNote: setup.defaultNote,
  });
}
