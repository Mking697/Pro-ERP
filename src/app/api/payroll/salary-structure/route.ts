import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { PayrollError, listUsersWithCurrentSalary, setSalaryStructure } from "@/lib/payroll/payroll";

/** Salary visibility is Role-gated (Admin), never a module grant — this is sensitive data
 * (see the parent task's own explicit instruction not to introduce a payroll grant). */

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const users = await listUsersWithCurrentSalary();
  return NextResponse.json({ users });
}

const bodySchema = z.object({
  userId: z.string().trim().min(1, "User select karein."),
  monthlySalary: z.coerce.number().positive("Monthly salary 0 se zyada honi chahiye."),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Effective From date 'YYYY-MM-DD' format me hona chahiye."),
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
    const salary = await setSalaryStructure(
      parsed.data.userId,
      parsed.data.monthlySalary,
      parsed.data.effectiveFrom,
      guard.session.userId
    );
    return NextResponse.json({ salary });
  } catch (err) {
    const message = err instanceof PayrollError ? err.message : "Salary set nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
