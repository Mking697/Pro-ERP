import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createAccount, LedgerError, listChartOfAccounts } from "@/lib/accounts/ledger";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const accounts = await listChartOfAccounts();
  return NextResponse.json({ accounts });
}

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;

const bodySchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(ACCOUNT_TYPES),
});

/** "+ Add Account" — an Admin/Accounts holder adding a Chart of Accounts row on top of the
 * 14 seeded defaults (see ledger.ts's createAccount() for the full reasoning). */
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
    const account = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.ledger.accounts.v1", actorId: guard.session.userId, key: getMutationKey(request),
      // Parsed JSON input; omit absent optional fields, never hash a Date/domain row.
      payload: JSON.parse(JSON.stringify({ ...parsed.data })),
    }, async () => ({ ...await createAccount(parsed.data) }));
    return NextResponse.json({ account });
  } catch (err) {
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof LedgerError || err instanceof Error ? err.message : "Account nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
