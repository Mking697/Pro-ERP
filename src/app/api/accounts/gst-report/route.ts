import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getGstReturnSummary } from "@/lib/accounts/accounts";

export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;

  const summary = await getGstReturnSummary({ from, to });
  return NextResponse.json(summary);
}
