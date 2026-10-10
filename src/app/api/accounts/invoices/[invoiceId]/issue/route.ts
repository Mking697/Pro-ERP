import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { AccountsError, issueInvoice } from "@/lib/accounts/accounts";
import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { invoiceId } = await params;
  try {
    const invoice = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.invoice-issue.v1", actorId: guard.session.userId, key: getMutationKey(request),
      payload: { invoiceId },
    }, async () => ({ ...await issueInvoice(invoiceId, guard.session.userId) }));
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ invoice: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError || err instanceof MutationInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof AccountsError || err instanceof Error ? err.message : "Issue nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
