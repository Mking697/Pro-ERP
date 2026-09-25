import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { rejectUnderDeviation, DeviationError } from "@/lib/inward/deviation";

/** Step 2b — clears a Requested entry back to un-requested. Same authorization shape as
 * approve-deviation (enforced inside rejectUnderDeviation() itself). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ failureLogId: string }> }
) {
  const guard = await requireModule("IQC_CHECK");
  if (!guard.ok) return guard.response;

  const { failureLogId } = await params;
  try {
    await rejectUnderDeviation(failureLogId, { userId: guard.session.userId, role: guard.session.role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof DeviationError || err instanceof Error ? err.message : "Reject nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
