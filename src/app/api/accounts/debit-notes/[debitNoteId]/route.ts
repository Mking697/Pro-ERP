import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getDebitNote } from "@/lib/accounts/debitNotes";
import { listIssuedBillsForVendor } from "@/lib/accounts/payables";

/** The note itself, plus its own vendor's Issued bills — backs the "Apply to a Bill"
 * dialog's own bill picker (only that vendor's own bills, never every bill). */
export async function GET(_request: Request, { params }: { params: Promise<{ debitNoteId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { debitNoteId } = await params;
  const debitNote = await getDebitNote(debitNoteId);
  if (!debitNote) {
    return NextResponse.json({ error: "Debit Note nahi mila." }, { status: 404 });
  }

  const bills = await listIssuedBillsForVendor(debitNote.vendorId);
  return NextResponse.json({ debitNote, bills });
}
