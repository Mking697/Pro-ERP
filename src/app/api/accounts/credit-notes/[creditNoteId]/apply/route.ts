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
    const creditNote = await applyCreditNoteToOrder(
      { creditNoteId, orderId: parsed.data.orderId, amount: parsed.data.amount },
      guard.session.userId
    );
    return NextResponse.json({ creditNote });
  } catch (err) {
    const message =
      err instanceof CreditNoteError || err instanceof Error ? err.message : "Apply nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
