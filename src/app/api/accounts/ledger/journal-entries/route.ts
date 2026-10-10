import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createManualJournalEntry, LedgerError } from "@/lib/accounts/ledger";
import { startOfIstDay } from "@/lib/timestamp";

const lineSchema = z.object({
  accountId: z.string().trim().min(1),
  debit: z.coerce.number().min(0).optional(),
  credit: z.coerce.number().min(0).optional(),
});

const bodySchema = z.object({
  description: z.string().trim().min(1),
  entryDate: z.string().trim().optional(),
  lines: z.array(lineSchema).min(2, "Journal entry me kam se kam 2 lines honi chahiye."),
});

/** "+ New Journal Entry" — a manual/adjusting entry, the correction mechanism this Ledger
 * has been documented as needing since it was first built (see ledger.ts's
 * createManualJournalEntry() for the full reasoning). */
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
    const entryId = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.manual-journal.create.v1", actorId: guard.session.userId, key: getMutationKey(request),
      // Hash the validated string date; convert to a domain Date only inside work.
      payload: JSON.parse(JSON.stringify(parsed.data)),
    }, () => createManualJournalEntry(
      {
        description: parsed.data.description,
        // A bare "YYYY-MM-DD" from the date picker must go through the same IST-day-aware
        // parsing this codebase already established for exactly this shape (see
        // ledger.ts's getTrialBalance() and src/lib/timestamp.ts's own header comment) —
        // new Date(dateString) would parse it as UTC, not IST, wall-clock.
        entryDate: parsed.data.entryDate ? startOfIstDay(parsed.data.entryDate) : undefined,
        lines: parsed.data.lines,
      },
      guard.session.userId
    ));
    return NextResponse.json({ id: entryId });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ id: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof LedgerError || err instanceof Error ? err.message : "Journal entry nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
