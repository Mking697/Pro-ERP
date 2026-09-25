import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { PayablesError, getBill, updateBill } from "@/lib/accounts/payables";

export async function GET(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { billId } = await params;
  const detail = await getBill(billId);
  if (!detail) {
    return NextResponse.json({ error: "Bill nahi mili." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

const bodySchema = z.object({
  billNo: z.string().trim().optional(),
  billAttachmentUrl: z.string().trim().optional(),
  amount: z.coerce.number().nonnegative().optional(),
  gstPercent: z.coerce.number().nonnegative().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ billId: string }> }) {
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
    const bill = await updateBill(billId, parsed.data);
    return NextResponse.json({ bill });
  } catch (err) {
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
