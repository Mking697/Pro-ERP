import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { PayrollError, finalizePayrollRun } from "@/lib/payroll/payroll";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { runId } = await params;
  try {
    const run = await finalizePayrollRun(runId, guard.session.userId);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof PayrollError ? err.message : "Finalize nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
