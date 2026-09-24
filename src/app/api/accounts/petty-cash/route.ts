import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getPettyCashBalance, listPettyCashEntries } from "@/lib/accounts/pettyCash";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const [entries, balance] = await Promise.all([listPettyCashEntries(), getPettyCashBalance()]);
  return NextResponse.json({ entries, balance });
}
