import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { cancelLeave, LeaveError } from "@/lib/leave/leaves";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ leaveId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { leaveId } = await params;

  try {
    const leave = await cancelLeave(leaveId, guard.session.userId, guard.session.role === "Admin");
    return NextResponse.json({ leave });
  } catch (err) {
    const message = err instanceof LeaveError || err instanceof Error ? err.message : "Cancel nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
