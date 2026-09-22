import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { PayablesError, issueBill } from "@/lib/accounts/payables";

export async function POST(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { billId } = await params;
  try {
    const bill = await issueBill(billId, guard.session.userId);
    return NextResponse.json({ bill });
  } catch (err) {
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Issue nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
