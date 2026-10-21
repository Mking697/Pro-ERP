import Razorpay from "razorpay";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { SubscriptionError } from "./subscriptions";
import { db } from "@/db/client";
import { razorpayPlanCache } from "@/db/schema";
import { getPlanPricePaise, type BillingCycle, type PlanTier } from "@/lib/platform/planLimits";

/**
 * Thin wrapper around the `razorpay` SDK + raw HMAC signature verification — the only
 * file that ever touches `RAZORPAY_KEY_SECRET`. Every other file in `src/lib/billing/**`
 * and every API route goes through this module, never reads the env var directly, so a
 * future audit only has one place to check for "does the secret ever leak client-side."
 */

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable — Razorpay billing can't work without it.`);
  }
  return value;
}

export function assertSubscriptionsReady(): void {
  if (process.env.RAZORPAY_SUBSCRIPTIONS_ENABLED !== "true" ||
      !["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].every(k => process.env[k]?.trim())) {
    throw new SubscriptionError("Subscriptions are not configured/enabled.", 503);
  }
}

let cachedClient: Razorpay | null = null;
let clientBinding = "";

function razorpayClient(): Razorpay {
  const keyId = requiredEnv("RAZORPAY_KEY_ID");
  const keySecret = requiredEnv("RAZORPAY_KEY_SECRET");
  const binding = createHash("sha256").update(JSON.stringify([keyId, keySecret])).digest("hex");
  if (!cachedClient || binding !== clientBinding) {
    cachedClient = new Razorpay({ key_id: keyId, key_secret: keySecret });
    clientBinding = binding;
  }
  return cachedClient;
}

/** The PUBLIC key id Checkout.js needs client-side — safe to return from an API route,
 * never the secret. Mirrors NEXT_PUBLIC_RAZORPAY_KEY_ID so the browser never needs its own
 * copy of the env var naming convention. */
export function razorpayPublicKeyId(): string {
  return requiredEnv("RAZORPAY_KEY_ID");
}

export interface CreateOrderInput {
  amountPaise: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

/** Minimum order amount Razorpay accepts is 100 paise (₹1) — every real plan price is far
 * above that, this is just a defensive floor against a future broken price entry. */
export async function createRazorpayOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
    throw new Error("Order amount kam se kam 100 paise (₹1) hona chahiye.");
  }
  const order = await razorpayClient().orders.create({
    amount: input.amountPaise,
    currency: input.currency ?? "INR",
    receipt: input.receipt,
    notes: input.notes,
  });
  return {
    id: order.id,
    amount: typeof order.amount === "string" ? Number(order.amount) : order.amount,
    currency: order.currency,
  };
}

/**
 * HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET), compared against what Razorpay's
 * Checkout handler returned — the one real proof a payment actually succeeded; the
 * browser's own "it worked" callback is never trusted on its own (see
 * src/lib/billing/billing.ts's `verifyAndApplyBillingPayment`, the only caller).
 * Timing-safe compare so a byte-by-byte early-exit can't leak the expected signature
 * through response-time differences.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const expected = createHmac("sha256", requiredEnv("RAZORPAY_KEY_SECRET"))
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Looks up (or, on first use, creates) the Razorpay Plan id for a tier+cycle combination
 * — see `razorpay_plan_cache`'s own schema comment for why this is cached rather than
 * re-created per subscription. `period`/`interval` for "Yearly" is `yearly`/`1`, not
 * `monthly`/`12` — Razorpay bills `interval` repetitions of `period`, and this codebase's
 * own Yearly price is already a real discounted lump sum (~2 months free), not 12
 * monthly charges, so the Plan itself must be a single yearly charge.
 */
export async function getOrCreateRazorpayPlanId(plan: PlanTier, cycle: BillingCycle): Promise<string> {
  assertSubscriptionsReady();
  const amountPaise = getPlanPricePaise(plan, cycle);
  if (!amountPaise) throw new Error("Invalid plan price.");
  const cacheId = razorpayPlanCacheKey(razorpayPublicKeyId(), plan, cycle, amountPaise);

  const [cached] = await db
    .select()
    .from(razorpayPlanCache)
    .where(eq(razorpayPlanCache.id, cacheId))
    .limit(1);
  if (cached) return cached.razorpayPlanId;

  const razorpayPlan = await razorpayClient().plans.create({
    period: cycle === "Yearly" ? "yearly" : "monthly",
    interval: 1,
    item: {
      name: `Pro ERP — ${plan} (${cycle})`,
      amount: amountPaise,
      currency: "INR",
    },
    notes: { plan, cycle },
  });

  // onConflictDoNothing guards a benign race: two requests both missing the cache at the
  // same instant would each create a Razorpay Plan (harmless — Razorpay allows duplicate
  // Plans, this just means one of the two created rows "wins" the cache and the other
  // Plan object sits unused on Razorpay's side forever, not a correctness problem) and
  // then both try to insert the same cache row; the loser's insert is a no-op, not a crash.
  await db
    .insert(razorpayPlanCache)
    .values({ id: cacheId, razorpayPlanId: razorpayPlan.id })
    .onConflictDoNothing();

  return razorpayPlan.id;
}

export interface CreateSubscriptionInput {
  planId: string;
  /** Razorpay requires a finite total_count even for an "indefinite" subscription — 100
   * cycles (100 months, or 100 years on a Yearly plan) is a practical "forever" that an
   * org can still cancel any time well before it would ever be reached. */
  totalCount?: number;
  notes?: Record<string, string>;
}

export interface RazorpaySubscriptionResult {
  id: string;
  status: string;
}

export async function createRazorpaySubscription(
  input: CreateSubscriptionInput
): Promise<RazorpaySubscriptionResult> {
  assertSubscriptionsReady();
  const subscription = await razorpayClient().subscriptions.create({
    plan_id: input.planId,
    total_count: input.totalCount ?? 100,
    customer_notify: 1,
    notes: input.notes,
  });
  return { id: subscription.id, status: subscription.status };
}

/** `cancelAtCycleEnd = true` (the default here) keeps the org's access through the
 * already-paid-for current cycle, matching standard SaaS cancel UX — Razorpay just stops
 * charging again after `current_end`, rather than revoking immediately. */
export async function cancelRazorpaySubscription(
  subscriptionId: string,
  cancelAtCycleEnd = true
): Promise<RazorpaySubscriptionResult> {
  assertSubscriptionsReady();
  const subscription = await razorpayClient().subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
  return { id: subscription.id, status: subscription.status };
}

/** HMAC of the EXACT raw body. Missing configuration is checked by the route (503). */
export function verifyRazorpayWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function razorpayPlanCacheKey(keyId: string, plan: PlanTier, cycle: BillingCycle, amountPaise: number): string {
  return `v2_${createHash("sha256").update(JSON.stringify([keyId, plan, cycle, amountPaise, "INR"])).digest("hex")}`;
}

export async function fetchRazorpaySubscription(id: string): Promise<unknown> {
  assertSubscriptionsReady(); return razorpayClient().subscriptions.fetch(id);
}
export async function fetchRazorpayPayment(id: string): Promise<unknown> {
  assertSubscriptionsReady(); return razorpayClient().payments.fetch(id);
}
export async function fetchRazorpayInvoice(id: string): Promise<unknown> {
  assertSubscriptionsReady(); return razorpayClient().invoices.fetch(id);
}
