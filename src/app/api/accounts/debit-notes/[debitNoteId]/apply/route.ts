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
    const debitNote = await applyDebitNoteToBill(
      { debitNoteId, billId: parsed.data.billId, amount: parsed.data.amount },
      guard.session.userId
    );
    return NextResponse.json({ debitNote });
  } catch (err) {
    const message =
      err instanceof DebitNoteError || err instanceof Error ? err.message : "Apply nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
