import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { PayablesError, recordBillPayment } from "@/lib/accounts/payables";

const bodySchema = z.object({
  amount: z.coerce.number().positive("Amount 0 se zyada hona chahiye."),
  mode: z.enum(["Cash", "UPI", "Bank_Transfer", "Cheque", "Card", "Other"]),
  reference: z.string().trim().optional(),
  paidAt: z.string().trim().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { billId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const bill = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.bill-payment.create.v1", actorId: guard.session.userId, key: getMutationKey(request),
      payload: JSON.parse(JSON.stringify({ billId, ...parsed.data })),
    }, async () => ({ ...await recordBillPayment(billId, parsed.data, guard.session.userId) }));
    return NextResponse.json({ bill });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ bill: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Payment record nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
