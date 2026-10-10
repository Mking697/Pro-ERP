import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { applyCreditNoteToOrder, CreditNoteError } from "@/lib/accounts/creditNotes";

const bodySchema = z.object({
  orderId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
});

export async function POST(request: Request, { params }: { params: Promise<{ creditNoteId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { creditNoteId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const creditNote = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.credit-note.apply.v1", actorId: guard.session.userId, key: getMutationKey(request),
      payload: { creditNoteId, ...parsed.data },
    }, async () => ({ ...await applyCreditNoteToOrder(
      { creditNoteId, ...parsed.data }, guard.session.userId
    ) }));
    return NextResponse.json({ creditNote });
  } catch (err) {
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof CreditNoteError || err instanceof Error ? err.message : "Apply nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
