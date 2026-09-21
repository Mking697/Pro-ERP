import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { decideLeaveStep, LeaveError } from "@/lib/leave/leaves";

const bodySchema = z.object({
  decision: z.enum(["Approved", "Rejected"]),
  remark: z.string().trim().optional().default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ leaveId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { leaveId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const leave = await decideLeaveStep(
      leaveId,
      guard.session.userId,
      parsed.data.decision,
      parsed.data.remark
    );
    return NextResponse.json({ leave });
  } catch (err) {
    const message = err instanceof LeaveError || err instanceof Error ? err.message : "Decision save nahi hua.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
