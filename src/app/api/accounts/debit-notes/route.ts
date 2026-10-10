import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createDebitNote, DebitNoteError, listDebitNotes } from "@/lib/accounts/debitNotes";

/** Listing/management view lives in Accounts. */
export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const debitNotes = await listDebitNotes();
  return NextResponse.json({ debitNotes });
}

const REASONS = ["IQC_Fail", "Other"] as const;

const bodySchema = z.object({
  vendorId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  reason: z.enum(REASONS).optional(),
  linkedFailureLogId: z.string().trim().optional(),
  attachmentUrl: z.string().trim().optional(),
});

/** Whoever is assigned to work the Failure Log entry issues the Debit Note (not
 * specifically an Accounts-grant holder) — same IQC_CHECK grant "Accept Under Deviation"
 * uses, per the user's own explicit split of responsibilities. */
export async function POST(request: Request) {
  const guard = await requireModule("IQC_CHECK");
  if (!guard.ok) return guard.response;

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
      operation: "accounts.debit-notes.v1", actorId: guard.session.userId, key: getMutationKey(request),
      // Parsed JSON input; omit absent optional fields, never hash a Date/domain row.
      payload: JSON.parse(JSON.stringify({ ...parsed.data })),
    }, async () => ({ ...await createDebitNote(parsed.data, guard.session.userId) }));
    return NextResponse.json({ debitNote });
  } catch (err) {
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof DebitNoteError || err instanceof Error ? err.message : "Debit Note nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
