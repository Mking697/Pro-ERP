import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
} from "@/lib/platform/shares";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const shares = await listReportShares(guard.session.orgId);
  return NextResponse.json({
    shares: shares.map((s) => ({
      token: s.Token,
      label: s.Label,
      rangeKey: s.Range_Key,
      createdBy: s.Created_By,
      createdAt: s.Created_At,
    })),
  });
}

const createSchema = z.object({
  label: z.string().trim().max(80).optional().default(""),
  rangeKey: z.string().trim().min(1).default("month"),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const share = await createReportShare({
      orgId: guard.session.orgId,
      label: parsed.data.label,
      rangeKey: parsed.data.rangeKey,
      from: parsed.data.from,
      to: parsed.data.to,
      // Only what this person can already see. A link can never show more than the
      // person who made it was allowed to look at.
      access: guard.session.access,
      createdBy: guard.session.email,
    });
    return NextResponse.json({ token: share.Token, label: share.Label });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Link nahi ban paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.json({ error: "Token missing." }, { status: 400 });
  }

  try {
    // Scoped to the caller's own organization inside the library, so one tenant can
    // never revoke another's link by guessing a token.
    await revokeReportShare(guard.session.orgId, token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Link band nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
