import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listBillCandidates } from "@/lib/accounts/payables";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const candidates = await listBillCandidates();
  return NextResponse.json({ candidates });
}
