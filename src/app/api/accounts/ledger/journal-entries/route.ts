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
    const entryId = await createManualJournalEntry(
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
    );
    return NextResponse.json({ id: entryId });
  } catch (err) {
    const message = err instanceof LedgerError || err instanceof Error ? err.message : "Journal entry nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
