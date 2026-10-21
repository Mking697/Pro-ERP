import { NextResponse } from "next/server";
import { verifyRazorpayWebhookSignature } from "@/lib/billing/razorpay";
import { applySubscriptionWebhookEvent } from "@/lib/billing/billing";

/**
 * Receives Razorpay Subscription lifecycle events (roadmap item #10) — the one place a
 * subscription's real-world state (an actual successful/failed/cancelled charge) becomes
 * this app's own truth. Registered once via `scripts/setup-razorpay-webhook.ts` (creates
 * the Dashboard webhook itself via the API, no manual Dashboard step) for:
 * `subscription.activated`, `subscription.charged`, `subscription.cancelled`,
 * `subscription.halted`, `subscription.completed`, `subscription.expired`.
 *
 * Deliberately NOT behind `requireRole`/any session guard — Razorpay's own servers call
 * this with no cookie at all. The HMAC-SHA256 signature check against the EXACT raw
 * request body (never `request.json()`'s re-parsed/re-stringified form, which can
 * byte-mismatch and silently break verification) is the only authentication. Every other
 * write only ever happens after this check passes.
 *
 * Always returns 200 once the signature is valid, even for an event this handler doesn't
 * specifically act on (e.g. `subscription.pending`) — Razorpay retries non-2xx responses,
 * and "we don't need to act on this one" must never look like a delivery failure.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature || !verifyRazorpayWebhookSignature(rawBody, signature)) {
    console.error("webhooks/razorpay: signature verify failed — rejecting.");
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const body = JSON.parse(rawBody) as {
    event: string;
    payload?: {
      subscription?: {
        entity?: {
          id: string;
          status: string;
          current_end?: number | null;
          notes?: Record<string, string>;
        };
      };
      payment?: {
        entity?: {
          id: string;
          order_id?: string;
          amount?: number;
        };
      };
    };
  };

  const RELEVANT_EVENTS = new Set([
    "subscription.activated",
    "subscription.charged",
    "subscription.cancelled",
    "subscription.halted",
    "subscription.completed",
    "subscription.expired",
  ]);

  const subscription = body.payload?.subscription?.entity;
  if (!RELEVANT_EVENTS.has(body.event) || !subscription) {
    // An event this handler doesn't act on (or a malformed/unexpected payload shape) —
    // still a valid, signed Razorpay request, so acknowledge it rather than retry-loop.
    return NextResponse.json({ received: true });
  }

  try {
    await applySubscriptionWebhookEvent({
      event: body.event,
      subscriptionId: subscription.id,
      status: subscription.status,
      plan: subscription.notes?.plan,
      billingCycle: subscription.notes?.cycle,
      currentEndUnix: subscription.current_end ?? undefined,
      paymentId: body.payload?.payment?.entity?.id,
      orderId: body.payload?.payment?.entity?.order_id,
      amountPaise: body.payload?.payment?.entity?.amount,
    });
  } catch (error) {
    console.error("webhooks/razorpay: apply failed:", error);
    // A genuine server-side failure (DB down, etc.) — let Razorpay retry.
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
