import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";

const DEFAULT_BASE_URL = "https://chatxflow.online";

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

/**
 * Whether a base URL is somewhere this server may be pointed at.
 *
 * The saved value goes straight into `fetch()` (src/lib/chatxflow.ts), and an Admin can
 * fire that request on demand through the "test message" endpoint — so an unvalidated
 * box here is a server-side request forgery: aim it at `http://169.254.169.254/…` or an
 * address inside the hosting network and read the answer back out of the error message.
 *
 * Rather than pinning one hostname — an organization may legitimately run ChatXFlow on
 * its own domain — this requires HTTPS and refuses the addresses that only ever mean
 * "somewhere inside the infrastructure".
 */
const PRIVATE_HOST = /^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|.*\.internal$|.*\.local$)/i;

function isSafeBaseUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return !PRIVATE_HOST.test(url.hostname);
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
        "Base URL ek https:// address hona chahiye, aur internal network ka pata nahi ho sakta.",
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
    upsertSetting("CHATXFLOW_BASE_URL", parsed.data.baseUrl.trim() || DEFAULT_BASE_URL),
  ];

  // Only overwrite the token if the admin actually typed a new one — the field is
  // never pre-filled with the real value, so an empty submit means "leave as-is".
  if (parsed.data.token.trim()) {
    writes.push(upsertSetting("CHATXFLOW_API_TOKEN", parsed.data.token.trim()));
  }

  await Promise.all(writes);
  return NextResponse.json({ success: true });
}
