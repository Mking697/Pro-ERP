import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listUsableCurrencies } from "@/lib/currency/currency";

/**
 * Just the currencies actually usable on an Order/Invoice/PO creation form right now —
 * any signed-in user, not Admin-only (unlike /api/admin/currencies, which also needs to
 * show disabled currencies so there's something for an Admin to toggle).
 */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const currencies = await listUsableCurrencies();
  return NextResponse.json({ currencies });
}
