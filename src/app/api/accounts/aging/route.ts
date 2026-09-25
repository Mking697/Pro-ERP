import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getReceivablesAging } from "@/lib/accounts/accounts";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const summary = await getReceivablesAging();
  return NextResponse.json(summary);
}
