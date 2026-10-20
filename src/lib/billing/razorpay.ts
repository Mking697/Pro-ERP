import Razorpay from "razorpay";
import { createHmac, timingSafeEqual } from "node:crypto";

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

let cachedClient: Razorpay | null = null;

function razorpayClient(): Razorpay {
  if (!cachedClient) {
    cachedClient = new Razorpay({
      key_id: requiredEnv("RAZORPAY_KEY_ID"),
      key_secret: requiredEnv("RAZORPAY_KEY_SECRET"),
    });
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
