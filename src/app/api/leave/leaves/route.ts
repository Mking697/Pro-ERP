import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { createLeave, listMyLeaves, LeaveError, LEAVE_TYPES } from "@/lib/leave/leaves";

/** Everyone can file their own leave — same tier as Tasks, no module grant needed. */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const leaves = await listMyLeaves(guard.session.userId);
  return NextResponse.json({ leaves });
}

const bodySchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date YYYY-MM-DD format me honi chahiye."),
  endDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "End date YYYY-MM-DD format me honi chahiye."),
  reason: z.string().trim().optional().default(""),
  buddyId: z.string().trim().min(1, "Buddy chunein."),
});

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const leave = await createLeave({
      doerId: guard.session.userId,
      leaveType: parsed.data.leaveType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason,
      buddyId: parsed.data.buddyId,
      isEmergency: false,
      filedBy: guard.session.userId,
    });
    return NextResponse.json({ leave });
  } catch (err) {
    const message = err instanceof LeaveError || err instanceof Error ? err.message : "Leave file nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
