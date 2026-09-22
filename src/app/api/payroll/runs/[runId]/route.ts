import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getPayrollRun } from "@/lib/payroll/payroll";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { runId } = await params;
  const result = await getPayrollRun(runId);
  if (!result) {
    return NextResponse.json({ error: "Payroll run nahi mila." }, { status: 404 });
  }
  return NextResponse.json(result);
}
