import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { PayablesError, issueBill } from "@/lib/accounts/payables";
import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { billId } = await params;
  try {
    const bill = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.bill-issue.v1", actorId: guard.session.userId, key: getMutationKey(request),
      payload: { billId },
    }, async () => ({ ...await issueBill(billId, guard.session.userId) }));
    return NextResponse.json({ bill });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ bill: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError || err instanceof MutationInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Issue nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
