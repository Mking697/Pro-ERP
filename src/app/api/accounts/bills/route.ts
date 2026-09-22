import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { PayablesError, createBill, listBills, type BillStatus } from "@/lib/accounts/payables";

const STATUSES: BillStatus[] = ["Draft", "Issued"];

export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as BillStatus) ? (statusParam as BillStatus) : undefined;

  const bills = await listBills(status);
  return NextResponse.json({ bills });
}

const bodySchema = z.object({
  poId: z.string().trim().min(1),
  billNo: z.string().trim().optional(),
  billAttachmentUrl: z.string().trim().optional(),
  amount: z.coerce.number().nonnegative(),
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
    const bill = await createBill(parsed.data, guard.session.userId);
    return NextResponse.json({ bill });
  } catch (err) {
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Bill ban nahi payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
