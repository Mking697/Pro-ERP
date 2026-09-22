import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { LEAVE_TYPES } from "@/lib/leave/leaves";
import { getLeaveQuotas, setLeaveQuota } from "@/lib/leave/quotas";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const quotas = await getLeaveQuotas();
  return NextResponse.json({ quotas });
}

const bodySchema = z.object({
  quotas: z
    .array(
      z.object({
        leaveType: z.enum(LEAVE_TYPES),
        // 0 (or omitted) means "no quota" — see setLeaveQuota().
        annualDays: z.number().min(0).max(365),
      })
    )
    .max(LEAVE_TYPES.length),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  for (const { leaveType, annualDays } of parsed.data.quotas) {
    await setLeaveQuota(leaveType, annualDays);
  }

  const quotas = await getLeaveQuotas();
  return NextResponse.json({ quotas });
}
