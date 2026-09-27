import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}${"•".repeat(Math.max(key.length - 8, 4))}${key.slice(-4)}`;
}

const DEFAULT_DAILY_CAP = 200;

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const [key, cap] = await Promise.all([
    getSetting("GEMINI_API_KEY"),
    getSetting("CHATBOT_DAILY_MESSAGE_CAP"),
  ]);

  return NextResponse.json({
    hasKey: Boolean(key),
    keyMasked: key ? maskKey(key) : "",
    dailyMessageCap: cap && Number(cap) > 0 ? Number(cap) : DEFAULT_DAILY_CAP,
  });
}

const bodySchema = z.object({
  apiKey: z.string().optional().default(""),
  dailyMessageCap: z.coerce.number().int().min(1).max(10000).optional(),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const writes: Promise<void>[] = [];

  // Only overwrite the key if the admin actually typed a new one — the field is never
  // pre-filled with the real value, so an empty submit means "leave as-is" (same
  // convention as CHATXFLOW_API_TOKEN in the WhatsApp settings form).
  if (parsed.data.apiKey.trim()) {
    writes.push(upsertSetting("GEMINI_API_KEY", parsed.data.apiKey.trim()));
  }
  if (parsed.data.dailyMessageCap) {
    writes.push(upsertSetting("CHATBOT_DAILY_MESSAGE_CAP", String(parsed.data.dailyMessageCap)));
  }

  await Promise.all(writes);
  return NextResponse.json({ success: true });
}
