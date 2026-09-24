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
    const creditNote = await createCreditNote(parsed.data, guard.session.userId);
    return NextResponse.json({ creditNote });
  } catch (err) {
    const message =
      err instanceof CreditNoteError || err instanceof Error ? err.message : "Credit Note nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
