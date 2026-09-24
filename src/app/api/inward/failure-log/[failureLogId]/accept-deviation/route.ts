import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { acceptUnderDeviation, DeviationError } from "@/lib/inward/deviation";

/** Same grant submitQualityCheck()'s own route already uses — the people who do quality
 * checks are the ones who decide whether a failed quantity is accepted under deviation. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ failureLogId: string }> }
) {
  const guard = await requireModule("IQC_CHECK");
  if (!guard.ok) return guard.response;

  const { failureLogId } = await params;
  try {
    await acceptUnderDeviation(failureLogId, guard.session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof DeviationError || err instanceof Error ? err.message : "Accept nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
