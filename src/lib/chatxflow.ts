import { getSetting } from "@/lib/settings";

const DEFAULT_BASE_URL = "https://chatxflow.online";

interface SendResult {
  ok: boolean;
  error?: string;
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
      body: JSON.stringify({ phone, message }),
    });

    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    if (res.ok && body.success) return { ok: true };
    return { ok: false, error: (body.error as string) || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
