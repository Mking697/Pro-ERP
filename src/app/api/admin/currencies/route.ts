import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { CurrencyError, listEnabledCurrencies, setEnabledCurrency } from "@/lib/currency/currency";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const currencies = await listEnabledCurrencies();
  return NextResponse.json({ currencies });
}

const bodySchema = z.object({
  code: z.string().trim().toUpperCase().min(1),
  enabled: z.boolean(),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
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
    await setEnabledCurrency(parsed.data.code, parsed.data.enabled);
  } catch (error) {
    if (error instanceof CurrencyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const currencies = await listEnabledCurrencies();
  return NextResponse.json({ currencies });
}
