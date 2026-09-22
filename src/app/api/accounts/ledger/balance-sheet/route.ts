import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getBalanceSheet } from "@/lib/accounts/ledger";

export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const asOf = url.searchParams.get("asOf") ?? undefined;

  const sheet = await getBalanceSheet(asOf);
  return NextResponse.json(sheet);
}
