import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getCreditRiskReport } from "@/lib/accounts/accounts";

export async function GET() {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const summary = await getCreditRiskReport();
  return NextResponse.json(summary);
}
