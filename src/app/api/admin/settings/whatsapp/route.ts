import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";

import { approvedChatXFlowBaseUrl, DEFAULT_CHATXFLOW_BASE_URL as DEFAULT_BASE_URL } from "@/lib/chatxflow";

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}${"•".repeat(Math.max(token.length - 8, 4))}${token.slice(-4)}`;
}

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const [token, phoneNumber, baseUrl] = await Promise.all([
    getSetting("CHATXFLOW_API_TOKEN"),
    getSetting("CHATXFLOW_PHONE_NUMBER"),
    getSetting("CHATXFLOW_BASE_URL"),
  ]);

  return NextResponse.json({
    hasToken: Boolean(token),
    tokenMasked: token ? maskToken(token) : "",
    phoneNumber: phoneNumber ?? "",
    baseUrl: baseUrl || DEFAULT_BASE_URL,
  });
}

/** Save-time policy matches the send-time policy; custom host DNS and redirects
 * are not trusted egress paths. */
function isSafeBaseUrl(value: string): boolean {
  return approvedChatXFlowBaseUrl(value) !== null;
}

const bodySchema = z.object({
  token: z.string().optional().default(""),
  phoneNumber: z.string().optional().default(""),
  baseUrl: z
    .string()
    .optional()
    .default(DEFAULT_BASE_URL)
    .refine((v) => !v.trim() || isSafeBaseUrl(v.trim()), {
      message:
        "Base URL sirf https://chatxflow.online hona chahiye; custom hosts allowed nahi hain.",
    }),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    // The specific reason, not a generic refusal — an admin who pasted an http:// URL
    // needs to be told that, or they will simply try the same thing again.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const writes = [
    upsertSetting("CHATXFLOW_PHONE_NUMBER", parsed.data.phoneNumber),
    upsertSetting("CHATXFLOW_BASE_URL", approvedChatXFlowBaseUrl(parsed.data.baseUrl)!),
  ];

  // Only overwrite the token if the admin actually typed a new one — the field is
  // never pre-filled with the real value, so an empty submit means "leave as-is".
  if (parsed.data.token.trim()) {
    writes.push(upsertSetting("CHATXFLOW_API_TOKEN", parsed.data.token.trim()));
  }

  await Promise.all(writes);
  return NextResponse.json({ success: true });
}