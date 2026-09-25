import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { approveUnderDeviation, DeviationError } from "@/lib/inward/deviation";

/** Step 2a — moves the failed quantity into real stock. Real authorization (the configured
 * Deviation Approver, or an Admin) is enforced inside approveUnderDeviation() itself, same
 * pattern as src/app/api/orders/[orderId]/credit-approve/route.ts's approveCreditHold() —
 * this route only checks the caller holds IQC_CHECK (the approver is expected to hold it
 * too, in practice). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ failureLogId: string }> }
) {
  const guard = await requireModule("IQC_CHECK");
  if (!guard.ok) return guard.response;

  const { failureLogId } = await params;
  try {
    await approveUnderDeviation(failureLogId, { userId: guard.session.userId, role: guard.session.role });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof DeviationError || err instanceof Error ? err.message : "Approve nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
