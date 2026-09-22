import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { LEAVE_TYPES } from "@/lib/leave/leaves";
import { getRemainingBalance } from "@/lib/leave/quotas";

/** The current user's own remaining balance for every leave type, for the current calendar
 * year — `null` for a type with no quota configured (unlimited). Shown in the filing dialog
 * before submitting, not just as a rejection after. */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const balances: Record<string, number | null> = {};
  for (const leaveType of LEAVE_TYPES) {
    balances[leaveType] = await getRemainingBalance(guard.session.userId, leaveType);
  }
  return NextResponse.json({ balances });
}
