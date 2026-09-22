import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { AccountsError, getInvoiceSuggestion } from "@/lib/accounts/accounts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;
  try {
    const suggestion = await getInvoiceSuggestion(orderId);
    return NextResponse.json(suggestion);
  } catch (err) {
    const message = err instanceof AccountsError || err instanceof Error ? err.message : "Suggestion nahi mili.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
