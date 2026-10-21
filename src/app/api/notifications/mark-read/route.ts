import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { markAllNotificationsRead, markNotificationsRead } from "@/lib/notifications/notifications";

const bodySchema = z.union([
  z.object({ ids: z.array(z.string()).min(1) }),
  z.object({ all: z.literal(true) }),
]);

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if ("all" in parsed.data) {
    await markAllNotificationsRead(guard.session.userId);
  } else {
    await markNotificationsRead(guard.session.userId, parsed.data.ids);
  }

  return NextResponse.json({ ok: true });
}
