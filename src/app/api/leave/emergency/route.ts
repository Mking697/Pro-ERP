import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createLeave, LeaveError, LEAVE_TYPES } from "@/lib/leave/leaves";

const bodySchema = z.object({
  doerId: z.string().trim().min(1, "Doer chunein."),
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

/** HR files this on a Doer's behalf — for when they genuinely can't file it themselves
 * (the whole reason "Emergency Leave" exists as its own path). */
export async function POST(request: Request) {
  const guard = await requireModule("LEAVE_HR");
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
      doerId: parsed.data.doerId,
      leaveType: parsed.data.leaveType,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason,
      buddyId: parsed.data.buddyId,
      isEmergency: true,
      filedBy: guard.session.userId,
    });
    return NextResponse.json({ leave });
  } catch (err) {
    const message = err instanceof LeaveError || err instanceof Error ? err.message : "Leave file nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
