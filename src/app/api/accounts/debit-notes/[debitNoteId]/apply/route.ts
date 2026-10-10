import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { applyDebitNoteToBill, DebitNoteError } from "@/lib/accounts/debitNotes";

const bodySchema = z.object({
  billId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
});

export async function POST(request: Request, { params }: { params: Promise<{ debitNoteId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { debitNoteId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const debitNote = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.debit-note.apply.v1", actorId: guard.session.userId, key: getMutationKey(request),
      payload: { debitNoteId, ...parsed.data },
    }, async () => ({ ...await applyDebitNoteToBill(
      { debitNoteId, ...parsed.data }, guard.session.userId
    ) }));
    return NextResponse.json({ debitNote });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ debitNote: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof DebitNoteError || err instanceof Error ? err.message : "Apply nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
