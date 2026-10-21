import { createHash, createHmac } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { webhookDeliveries, webhookSubscriptions } from "@/db/schema";
import { db } from "@/db/client";
import { insertRecord } from "@/db/repo";
import { generateId } from "@/lib/id";
import { listDomainEventsSince } from "@/lib/events/emit";

/**
 * Webhook delivery — a POLLER of the `domain_events` log (src/lib/events/emit.ts), not
 * anything wired synchronously into the emit path (per that file's own contract). The
 * actual polling loop (`dispatchPendingWebhooks()`) is driven by a cron route
 * (src/app/api/cron/dispatch-webhooks/route.ts) hitting this on a short interval.
 *
 * Known subscribable event types — a subset of src/lib/events/emit.ts's own documented
 * list, the only two that are actually emitted anywhere today:
 *   - "order.status_changed"
 *   - "stock.movement_recorded"
 *
 * SIGNING SCHEME (documented here for whoever integrates against this as a customer):
 * every delivered POST body is the raw JSON string `{ id, type, payload, createdAt }`.
 * The `X-Pro-ERP-Signature` header is `sha256=<hex>`, where `<hex>` is the HMAC-SHA256 of
 * that exact raw body, keyed with the subscription's own `secret` (shown once, at
 * creation/regeneration time). A receiver verifies authenticity by recomputing the same
 * HMAC over the exact bytes it received and comparing it to the header.
 */

export const SUBSCRIBABLE_EVENT_TYPES = ["order.status_changed", "stock.movement_recorded"] as const;
export type SubscribableEventType = (typeof SUBSCRIBABLE_EVENT_TYPES)[number];

export class WebhookError extends Error {}

const PRIVATE_IPV4_PREFIXES = ["10.", "127.", "169.254.", "192.168."];

function isPrivateIpv4(host: string): boolean {
  if (PRIVATE_IPV4_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Rejects localhost / private / link-local hostnames so a webhook URL can't be used to
 * make this server issue requests into its own internal network (SSRF). Deliberately a
 * plain hostname/string check, not a DNS resolution — a receiver that resolves to a
 * private IP only at request time is a defense-in-depth gap this function does not try
 * to close; it stops the obvious, directly-typed cases. */
export function isPrivateOrLocalHost(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true; // Unparseable is treated as unsafe, not "not private".
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0") return true;
  if (isPrivateIpv4(host)) return true;
  return false;
}

function assertValidWebhookUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebhookError("Webhook URL valid nahi hai.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebhookError("Webhook URL http:// ya https:// se shuru honi chahiye.");
  }
  if (isPrivateOrLocalHost(rawUrl)) {
    throw new WebhookError("Webhook URL kisi local/private network address ko point nahi kar sakti.");
  }
  return parsed;
}

function assertValidEventTypes(eventTypes: string[]): SubscribableEventType[] {
  const filtered = eventTypes.filter((t): t is SubscribableEventType =>
    (SUBSCRIBABLE_EVENT_TYPES as readonly string[]).includes(t)
  );
  if (filtered.length === 0) {
    throw new WebhookError("Kam se kam ek valid event type chunein.");
  }
  return filtered;
}

function randomSecret(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

export interface WebhookSubscriptionSummary {
  id: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: string;
}

export interface NewWebhookSubscription extends WebhookSubscriptionSummary {
  /** Shown exactly once, here (and again from `regenerateWebhookSecret()`). Never
   * retrievable after this response. */
  plaintextSecret: string;
}

function toSummary(row: typeof webhookSubscriptions.$inferSelect): WebhookSubscriptionSummary {
  return {
    id: row.id,
    url: row.url,
    eventTypes: row.eventTypes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createWebhookSubscription(
  orgId: string,
  input: { url: string; eventTypes: string[] },
  createdBy: string
): Promise<NewWebhookSubscription> {
  const url = assertValidWebhookUrl(input.url);
  const eventTypes = assertValidEventTypes(input.eventTypes);
  const secret = randomSecret(48);

  const row = await insertRecord(webhookSubscriptions, {
    id: generateId("WHK"),
    orgId,
    url: url.toString(),
    eventTypes,
    secret,
    createdBy,
  });

  return { ...toSummary(row), plaintextSecret: secret };
}

/** Never returns the raw secret — matches the apiKeys convention exactly. Use
 * `regenerateWebhookSecret()` if the Admin has lost theirs. */
export async function listWebhookSubscriptions(orgId: string): Promise<WebhookSubscriptionSummary[]> {
  const rows = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.orgId, orgId));
  return rows.map(toSummary).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function updateWebhookSubscription(
  orgId: string,
  id: string,
  patch: { url?: string; eventTypes?: string[]; isActive?: boolean }
): Promise<WebhookSubscriptionSummary | null> {
  const set: Record<string, unknown> = {};
  if (patch.url !== undefined) set.url = assertValidWebhookUrl(patch.url).toString();
  if (patch.eventTypes !== undefined) set.eventTypes = assertValidEventTypes(patch.eventTypes);
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  if (Object.keys(set).length === 0) {
    const rows = await db
      .select()
      .from(webhookSubscriptions)
      .where(and(eq(webhookSubscriptions.orgId, orgId), eq(webhookSubscriptions.id, id)))
      .limit(1);
    return rows[0] ? toSummary(rows[0]) : null;
  }
  const [row] = await db
    .update(webhookSubscriptions)
    .set(set)
    .where(and(eq(webhookSubscriptions.orgId, orgId), eq(webhookSubscriptions.id, id)))
    .returning();
  return row ? toSummary(row) : null;
}

/** Issues a fresh secret for an existing subscription (the "lost my secret" path) —
 * shown once, exactly like creation. */
export async function regenerateWebhookSecret(
  orgId: string,
  id: string
): Promise<{ plaintextSecret: string } | null> {
  const secret = randomSecret(48);
  const [row] = await db
    .update(webhookSubscriptions)
    .set({ secret })
    .where(and(eq(webhookSubscriptions.orgId, orgId), eq(webhookSubscriptions.id, id)))
    .returning({ id: webhookSubscriptions.id });
  return row ? { plaintextSecret: secret } : null;
}

export async function deleteWebhookSubscription(orgId: string, id: string): Promise<boolean> {
  const [row] = await db
    .delete(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.orgId, orgId), eq(webhookSubscriptions.id, id)))
    .returning({ id: webhookSubscriptions.id });
  return Boolean(row);
}

/** Internal-only read (for the "send test ping" route — it needs the real secret to sign
 * the synthetic payload). Never exposed through a list/summary endpoint. */
export async function getWebhookSubscriptionWithSecret(orgId: string, id: string) {
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(and(eq(webhookSubscriptions.orgId, orgId), eq(webhookSubscriptions.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Signing + delivery
// ---------------------------------------------------------------------------

export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

interface PostResult {
  ok: boolean;
  status: number | null;
  bodySnippet: string;
}

async function postWebhook(url: string, secret: string, rawBody: string): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Pro-ERP-Signature": signPayload(secret, rawBody),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, bodySnippet: text.slice(0, 500) };
  } catch (error) {
    return { ok: false, status: null, bodySnippet: (error instanceof Error ? error.message : String(error)).slice(0, 500) };
  }
}

/** attempt 1 -> retry in 1min, attempt 2 -> 5min, attempt 3 -> 30min, attempt 4+ ->
 * abandoned (never retried again). */
const BACKOFF_MINUTES = [1, 5, 30];
const MAX_ATTEMPTS = 3;

function nextRetryAt(attemptCount: number): Date | null {
  if (attemptCount > BACKOFF_MINUTES.length) return null;
  const minutes = BACKOFF_MINUTES[attemptCount - 1];
  return new Date(Date.now() + minutes * 60_000);
}

async function recordAttempt(
  deliveryId: string,
  attemptCount: number,
  result: PostResult
): Promise<void> {
  const abandoned = !result.ok && attemptCount >= MAX_ATTEMPTS;
  const status = result.ok ? "Success" : abandoned ? "Abandoned" : "Failed";
  await db
    .update(webhookDeliveries)
    .set({
      attemptCount,
      status,
      lastAttemptAt: new Date(),
      nextRetryAt: result.ok || abandoned ? null : nextRetryAt(attemptCount),
      responseStatus: result.status,
      responseSnippet: result.bodySnippet,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

/** Re-POSTs every Failed delivery for `subscription` whose `nextRetryAt` has arrived.
 * Independent of cursor advancement — a retrying delivery's own row tracks its own next
 * attempt; it never blocks newer events from being polled/delivered. */
async function retryDueDeliveries(subscription: typeof webhookSubscriptions.$inferSelect): Promise<void> {
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.orgId, subscription.orgId),
        eq(webhookDeliveries.subscriptionId, subscription.id),
        eq(webhookDeliveries.status, "Failed"),
        lte(webhookDeliveries.nextRetryAt, new Date())
      )
    );

  for (const delivery of due) {
    const body = JSON.stringify({
      id: delivery.eventId,
      type: delivery.eventType,
      payload: delivery.payload ?? {},
      createdAt: delivery.createdAt.toISOString(),
    });
    const result = await postWebhook(subscription.url, subscription.secret, body);
    await recordAttempt(delivery.id, delivery.attemptCount + 1, result);
  }
}

/** Polls fresh events for `subscription` since its own cursor, delivers each once, and
 * advances the cursor to the last event in the page once every event in it has been
 * attempted (Success, or moved into Failed-with-a-pending-retry / Abandoned) — a
 * currently-retrying delivery never blocks the cursor past it. */
async function deliverNewEvents(subscription: typeof webhookSubscriptions.$inferSelect): Promise<void> {
  const page = await listDomainEventsSince(
    subscription.orgId,
    subscription.cursorEventId,
    subscription.eventTypes,
    100
  );
  if (page.events.length === 0) return;

  for (const event of page.events) {
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    });

    const deliveryRow = await insertRecord(webhookDeliveries, {
      id: generateId("WHD"),
      orgId: subscription.orgId,
      subscriptionId: subscription.id,
      eventId: event.id,
      eventType: event.type,
      url: subscription.url,
      payload: event.payload,
    });

    const result = await postWebhook(subscription.url, subscription.secret, body);
    await recordAttempt(deliveryRow.id, 1, result);
  }

  await db
    .update(webhookSubscriptions)
    .set({ cursorEventId: page.nextSinceId })
    .where(eq(webhookSubscriptions.id, subscription.id));
}

/**
 * The actual delivery engine — called from the cron route, never per-request. Processes
 * every active subscription of every org independently (plain sequential awaits, NOT one
 * giant cross-org transaction — this is a background job, not a user-facing atomic
 * operation, so one org's slow/broken webhook must never block another's).
 */
export async function dispatchPendingWebhooks(): Promise<{ processed: number; errors: number }> {
  const subscriptions = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.isActive, true));

  let processed = 0;
  let errors = 0;
  for (const subscription of subscriptions) {
    try {
      await retryDueDeliveries(subscription);
      await deliverNewEvents(subscription);
      processed++;
    } catch {
      errors++;
      // One subscription's failure must not stop the rest — deliberately swallowed here
      // (the per-attempt failure itself is already recorded on its own delivery row).
    }
  }
  return { processed, errors };
}

/** Builds + signs + POSTs a synthetic `test.ping` event directly, bypassing
 * domain_events entirely (no delivery row, no cursor interaction) — just a connectivity
 * check for the Admin wiring up a receiver. */
export async function sendTestPing(orgId: string, subscriptionId: string): Promise<PostResult> {
  const subscription = await getWebhookSubscriptionWithSecret(orgId, subscriptionId);
  if (!subscription) throw new WebhookError("Webhook subscription nahi mili.");
  const body = JSON.stringify({
    id: `test-${Date.now()}`,
    type: "test.ping",
    payload: {},
    createdAt: new Date().toISOString(),
  });
  return postWebhook(subscription.url, subscription.secret, body);
}

// Re-exported so tests can hash-check without importing node:crypto twice.
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
