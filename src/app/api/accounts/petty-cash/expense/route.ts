import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { PettyCashError, recordPettyCashExpense } from "@/lib/accounts/pettyCash";
import { LedgerError } from "@/lib/accounts/ledger";

const bodySchema = z.object({
  categoryAccountId: z.string().trim().min(1),
  description: z.string().trim().optional(),
  amount: z.coerce.number().positive(),
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
    const entry = await recordPettyCashExpense(parsed.data, guard.session.userId);
    return NextResponse.json({ entry });
  } catch (err) {
    const message =
      err instanceof PettyCashError || err instanceof LedgerError || err instanceof Error
        ? err.message
        : "Expense record nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
