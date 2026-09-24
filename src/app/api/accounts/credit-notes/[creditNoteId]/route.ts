import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getCreditNote } from "@/lib/accounts/creditNotes";
import { listOrdersForCustomer } from "@/lib/orders/orders";

/** The note itself, plus its own customer's candidate orders — backs the "Apply to an
 * Order" dialog's own order picker (only that customer's own orders, never every order). */
export async function GET(_request: Request, { params }: { params: Promise<{ creditNoteId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { creditNoteId } = await params;
  const creditNote = await getCreditNote(creditNoteId);
  if (!creditNote) {
    return NextResponse.json({ error: "Credit Note nahi mila." }, { status: 404 });
  }

  const orders = await listOrdersForCustomer(creditNote.customerId);
  return NextResponse.json({ creditNote, orders });
}
