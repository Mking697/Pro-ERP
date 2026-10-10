import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
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
  gstPercent: z.coerce.number().nonnegative().optional(),
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
    const bill = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.bills.v1", actorId: guard.session.userId, key: getMutationKey(request),
      // Parsed JSON input; omit absent optional fields, never hash a Date/domain row.
      payload: JSON.parse(JSON.stringify({ ...parsed.data })),
    }, async () => ({ ...await createBill(parsed.data, guard.session.userId) }));
    return NextResponse.json({ bill });
  } catch (err) {
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof PayablesError || err instanceof Error ? err.message : "Bill ban nahi payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
