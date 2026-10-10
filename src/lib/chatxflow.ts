import { getAllSettings, getSetting } from "@/lib/settings";
import { getTenantOrgId } from "@/lib/tenant";
import { logError } from "@/lib/errorLog";

export const DEFAULT_CHATXFLOW_BASE_URL = "https://chatxflow.online";

/** Only the explicitly approved provider origin is supported. Do not accept custom
 * hosts, subdomains, credentials, ports, paths or queries: tenant-controlled DNS must
 * never select this server's egress destination. Custom providers require a separately
 * reviewed connection-pinned transport; adding a hostname regex is not sufficient. */
export function approvedChatXFlowBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim() || DEFAULT_CHATXFLOW_BASE_URL);
    if (url.origin !== DEFAULT_CHATXFLOW_BASE_URL || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

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
  return { baseUrl: baseUrl || DEFAULT_CHATXFLOW_BASE_URL, token };
}

const CALL_BUDGET_MS = 20_000;
const BATCH_BUDGET_MS = 60_000;
const RECIPIENT_WORKERS = 4;
type SenderConfig = { baseUrl: string; token: string };
export interface WhatsAppRecipient { phone: string; message: string }

/** No retries: a lost acknowledgement or deadline may already have delivered. */
async function sendConfigured(config: SenderConfig | null, phone: string, message: string,
  parent?: AbortSignal): Promise<SendResult> {
  if (!phone) return { ok: false, error: "Phone number missing." };
  if (!config) return { ok: false, error: "ChatXFlow abhi Settings me configure nahi hua hai." };
  const baseUrl = approvedChatXFlowBaseUrl(config.baseUrl);
  if (!baseUrl) return { ok: false, error: "Only https://chatxflow.online is an approved WhatsApp provider." };
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, CALL_BUDGET_MS);
  let rejectDeadline: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = () => reject(new Error("WhatsApp deadline exceeded; delivery outcome unknown. Do not retry automatically."));
    controller.signal.addEventListener("abort", rejectDeadline, { once: true });
  });
  try {
    if (parent?.aborted) abort();
    const operation = async () => {
      if (controller.signal.aborted) throw new Error("WhatsApp budget exhausted.");
      const res = await fetch(`${baseUrl}/api/v1/send`, {
        redirect: "error", method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ phone: normalizePhone(phone), message }),
      });
      const body = await res.json().catch((error: unknown) => {
        if (controller.signal.aborted) throw error;
        return {} as Record<string, unknown>;
      });
      return res.ok && body.success ? { ok: true } :
        { ok: false, error: (body.error as string) || `HTTP ${res.status}` };
    };
    // Signal actually cancels fetch/body; race also bounds non-cooperative transports.
    return await Promise.race([operation(), deadline]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (rejectDeadline) controller.signal.removeEventListener("abort", rejectDeadline);
  }
}

export async function sendWhatsAppMessage(phone: string, message: string): Promise<SendResult> {
  try {
    if (!phone) return { ok: false, error: "Phone number missing." };
    const result = await sendConfigured(await getConfig(), phone, message);
    // Deadline failures must not wait on another unbounded external logging operation.
    if (!result.ok && result.error && !result.error.includes("deadline") && !result.error.includes("configure")) {
      await logWhatsAppFailure(result.error).catch(() => undefined);
    }
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/** One tenant-local snapshot, four workers, a shared end-to-end send budget.
 * Unstarted recipients count as failed; active timeouts are unknown delivery, never retried.
 * No failure-log DB writes here: they must not outlive or extend the send budget. */
export async function sendWhatsAppBatch(recipients: WhatsAppRecipient[]): Promise<{ sent: number; failed: number }> {
  if (!recipients.length) return { sent: 0, failed: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BATCH_BUDGET_MS);
  let next = 0; let sent = 0;
  let rejectBudget: (() => void) | undefined;
  const budget = new Promise<never>((_resolve, reject) => {
    rejectBudget = () => reject(new Error("WhatsApp batch budget exhausted"));
    controller.signal.addEventListener("abort", rejectBudget, { once: true });
  });
  try {
    const snapshot = await Promise.race([getAllSettings(), budget]);
    const config = snapshot.CHATXFLOW_API_TOKEN ? {
      baseUrl: snapshot.CHATXFLOW_BASE_URL || DEFAULT_CHATXFLOW_BASE_URL,
      token: snapshot.CHATXFLOW_API_TOKEN,
    } : null;
    const worker = async () => {
      while (!controller.signal.aborted && next < recipients.length) {
        const recipient = recipients[next++];
        const result = await sendConfigured(config, recipient.phone, recipient.message, controller.signal);
        if (result.ok) sent++;
      }
    };
    // sendConfigured is bounded and joined: no detached recipient work after return.
    await Promise.all(Array.from({ length: Math.min(RECIPIENT_WORKERS, recipients.length) }, worker));
  } catch {
    controller.abort();
  } finally {
    clearTimeout(timer);
    if (rejectBudget) controller.signal.removeEventListener("abort", rejectBudget);
  }
  return { sent, failed: recipients.length - sent };
}

/** A genuine send failure (not "ChatXFlow isn't configured", which is expected state for
 * most orgs) — logged so it shows up at /platform instead of only ever being a silently
 * swallowed { ok: false } nobody happened to check. */
async function logWhatsAppFailure(message: string): Promise<void> {
  const orgId = await getTenantOrgId().catch(() => "");
  await logError({ orgId, routePath: "whatsapp:send", message });
}