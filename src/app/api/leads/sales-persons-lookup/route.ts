import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listSalesPersons } from "@/lib/leads/leads";

/**
 * Minimal sales-person list for the "Assign To" dropdown (New Lead form + bulk import
 * reference) — every Active user who holds LEAD_FMS. Mirrors
 * /api/parties/vendors/lookup's shape (id + name only).
 */
export async function GET() {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const salesPersons = await listSalesPersons();
  return NextResponse.json({ salesPersons });
}
