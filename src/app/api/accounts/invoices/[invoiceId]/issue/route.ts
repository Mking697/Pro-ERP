import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { AccountsError, issueInvoice } from "@/lib/accounts/accounts";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { invoiceId } = await params;
  try {
    const invoice = await issueInvoice(invoiceId, guard.session.userId);
    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof AccountsError || err instanceof Error ? err.message : "Issue nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
