import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSubscriptionsReady, verifyRazorpayWebhookSignature } from "@/lib/billing/razorpay";
import { applySubscriptionWebhookEvent } from "@/lib/billing/billing";

const events = new Set(["subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.pending", "subscription.halted", "subscription.cancelled", "subscription.completed", "subscription.expired", "subscription.paused", "subscription.resumed", "subscription.updated"]);
const envelope = z.object({ event: z.string().min(1) }).passthrough();
const payload = z.object({
  payload: z.object({
    subscription: z.object({ entity: z.object({ id: z.string().regex(/^sub_[A-Za-z0-9]+$/) }).passthrough() }).passthrough(),
    payment: z.object({ entity: z.object({ id: z.string().regex(/^pay_[A-Za-z0-9]+$/) }).passthrough() }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

export async function POST(request: Request) {
  try { assertSubscriptionsReady(); }
  catch { return NextResponse.json({ error: "Subscriptions unavailable." }, { status: 503 }); }
  const raw = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature || !verifyRazorpayWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
  catch { return NextResponse.json({ error: "Malformed JSON." }, { status: 400 }); }
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  if (!events.has(parsed.data.event)) return NextResponse.json({ received: true });
  const data = payload.safeParse(body);
  if (!data.success || (parsed.data.event === "subscription.charged" && !data.data.payload.payment)) {
    return NextResponse.json({ error: "Invalid subscription payload." }, { status: 400 });
  }
  try {
    await applySubscriptionWebhookEvent({ event: parsed.data.event, subscriptionId: data.data.payload.subscription.entity.id, ...(data.data.payload.payment ? { paymentId: data.data.payload.payment.entity.id } : {}) });
  } catch {
    return NextResponse.json({ error: "Processing failed." }, { status: 503 });
  }
  return NextResponse.json({ received: true });
}
