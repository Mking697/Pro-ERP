import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getProfitAndLoss } from "@/lib/accounts/ledger";

export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const pnl = await getProfitAndLoss({ from, to });
  return NextResponse.json(pnl);
}
