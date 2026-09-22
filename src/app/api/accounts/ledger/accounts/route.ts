import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listChartOfAccounts } from "@/lib/accounts/ledger";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const accounts = await listChartOfAccounts();
  return NextResponse.json({ accounts });
}
