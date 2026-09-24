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
    const account = await createAccount(parsed.data);
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof LedgerError || err instanceof Error ? err.message : "Account nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
