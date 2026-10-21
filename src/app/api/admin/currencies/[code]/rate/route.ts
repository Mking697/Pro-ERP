import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { CurrencyError, getLatestExchangeRate, recordExchangeRate } from "@/lib/currency/currency";

const bodySchema = z.object({
  rateToInr: z.number().positive().finite(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { code } = await params;
  const rate = await getLatestExchangeRate(code.toUpperCase());
  return NextResponse.json({ rate });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { code } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const rate = await recordExchangeRate(
      code.toUpperCase(),
      parsed.data.rateToInr,
      guard.session.email
    );
    return NextResponse.json({ rate });
  } catch (error) {
    if (error instanceof CurrencyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
