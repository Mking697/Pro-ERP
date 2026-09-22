import { getSetting } from "@/lib/settings";
import { getTenantOrgId } from "@/lib/tenant";
import { logError } from "@/lib/errorLog";

const DEFAULT_BASE_URL = "https://chatxflow.online";

interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * ChatXFlow expects a full number with country code (e.g. "919876543210") — the same shape
 * the org's own WhatsApp Mobile Number in Settings already uses. A user's own "Phone
 * (WhatsApp)" field has no country-code hint on it, so a bare 10-digit Indian mobile
 * number (the thing most admins actually type) silently fails to deliver otherwise — this
 * was the real cause behind FMS step notifications and task-completion confirmations never
 * arriving even though nothing anywhere reported an error. Anything that already looks
 * like it carries a country code is left untouched rather than guessed at.
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

async function getConfig(): Promise<{ baseUrl: string; token: string } | null> {
  const [baseUrl, token] = await Promise.all([
    getSetting("CHATXFLOW_BASE_URL"),
    getSetting("CHATXFLOW_API_TOKEN"),
  ]);
  if (!token) return null;
  return { baseUrl: baseUrl || DEFAULT_BASE_URL, token };
}

/** Sends one WhatsApp message via the ChatXFlow Developer API. Never throws — callers get
 * an { ok, error } result so a failed notification never has to block the caller's own flow. */
export async function sendWhatsAppMessage(phone: string, message: string): Promise<SendResult> {
  if (!phone) return { ok: false, error: "Phone number missing." };

  const config = await getConfig();
  if (!config) return { ok: false, error: "ChatXFlow abhi Settings me configure nahi hua hai." };

  try {
    const res = await fetch(`${config.baseUrl}/api/v1/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ phone: normalizePhone(phone), message }),
    });

    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (res.ok && body.success) return { ok: true };

    const apiError = (body.error as string) || `HTTP ${res.status}`;
    await logWhatsAppFailure(apiError);
    return { ok: false, error: apiError };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logWhatsAppFailure(message);
    return { ok: false, error: message };
  }
}

/** A genuine send failure (not "ChatXFlow isn't configured", which is expected state for
 * most orgs) — logged so it shows up at /platform instead of only ever being a silently
 * swallowed { ok: false } nobody happened to check. */
async function logWhatsAppFailure(message: string): Promise<void> {
  const orgId = await getTenantOrgId().catch(() => "");
  await logError({ orgId, routePath: "whatsapp:send", message });
}
