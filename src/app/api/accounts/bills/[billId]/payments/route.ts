import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { PayablesError, recordBillPayment } from "@/lib/accounts/payables";

const bodySchema = z.object({
  amount: z.coerce.number().positive("Amount 0 se zyada hona chahiye."),
  mode: z.enum(["Cash", "UPI", "Bank_Transfer", "Cheque", "Card", "Other"]),
  reference: z.string().trim().optional(),
  paidAt: z.string().trim().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { billId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const bill = await recordBillPayment(billId, parsed.data, guard.session.userId);
    return NextResponse.json({ bill });
  } catch (err) {
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Payment record nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
