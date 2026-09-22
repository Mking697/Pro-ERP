import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { PayrollError, generatePayrollRun, listPayrollRuns } from "@/lib/payroll/payroll";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const runs = await listPayrollRuns();
  return NextResponse.json({ runs });
}

const bodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month 'YYYY-MM' format me hona chahiye."),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  try {
    const result = await generatePayrollRun(parsed.data.month, guard.session.userId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof PayrollError ? err.message : "Payroll run generate nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
