import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createCreditNote, CreditNoteError, listCreditNotes } from "@/lib/accounts/creditNotes";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const creditNotes = await listCreditNotes();
  return NextResponse.json({ creditNotes });
}

const REASONS = ["Sales_Return", "Transit_Loss", "Price_Adjustment", "Other"] as const;

const bodySchema = z.object({
  invoiceId: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  reason: z.enum(REASONS).optional(),
  gstAmount: z.coerce.number().min(0).optional(),
  attachmentUrl: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
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
    const creditNote = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.credit-notes.v1", actorId: guard.session.userId, key: getMutationKey(request),
      // Parsed JSON input; omit absent optional fields, never hash a Date/domain row.
      payload: JSON.parse(JSON.stringify({ ...parsed.data })),
    }, async () => ({ ...await createCreditNote(parsed.data, guard.session.userId) }));
    return NextResponse.json({ creditNote });
  } catch (err) {
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof CreditNoteError || err instanceof Error ? err.message : "Credit Note nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
