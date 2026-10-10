import { NextResponse } from "next/server";
import { getMutationKey, MutationConflictError } from "@/lib/mutations";
import { requireModule } from "@/lib/auth/guard";
import { requestUnderDeviation, DeviationError } from "@/lib/inward/deviation";

/** Step 1 of "Accept Under Deviation" — same grant submitQualityCheck()'s own route already
 * uses — the people who do quality checks are the ones who decide whether a failed
 * quantity is worth requesting a deviation for. Does NOT move stock; see approve-deviation. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ failureLogId: string }> }
) {
  const guard = await requireModule("IQC_CHECK");
  if (!guard.ok) return guard.response;

  const { failureLogId } = await params;
  try {
    await requestUnderDeviation(failureLogId, guard.session.userId, getMutationKey(request));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ ok: true, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof DeviationError || err instanceof Error ? err.message : "Request nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
