import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listPayslipsForUser } from "@/lib/payroll/payroll";

/** Any signed-in user may read their own payslips — no role/grant check, mirroring how
 * every user can see their own Tasks/Leave without a special grant. */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const payslips = await listPayslipsForUser(guard.session.userId);
  return NextResponse.json({ payslips });
}
