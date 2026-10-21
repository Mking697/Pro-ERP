/**
 * One-time setup: registers this deployment's Razorpay webhook endpoint via the API
 * (Dashboard → Settings → Webhooks does the exact same thing manually — this just avoids
 * the manual click-through) for the Subscription lifecycle events
 * `src/app/api/webhooks/razorpay/route.ts` listens for. Idempotent: if a webhook for the
 * exact same URL already exists, it's left alone (its secret is NOT re-readable from the
 * API, so this script can't safely "update" one blindly — delete it in the Razorpay
 * Dashboard first if you really need to re-register with a new secret).
 *
 * Usage (run once per environment/key-pair — test-mode and live-mode keys are entirely
 * separate Razorpay "accounts" from the Dashboard's point of view, each needs its own
 * webhook registration):
 *   RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=... npx tsx scripts/setup-razorpay-webhook.ts https://erp.nextgenauto.online
 *
 * Prints the webhook secret EXACTLY ONCE (Razorpay never returns it again after
 * creation) — copy it into RAZORPAY_WEBHOOK_SECRET in .env immediately.
 */
import Razorpay from "razorpay";
import { randomBytes } from "node:crypto";

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error("Usage: npx tsx scripts/setup-razorpay-webhook.ts <https://your-domain>");
    process.exit(1);
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.error("RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET must be set in the environment.");
    process.exit(1);
  }

  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhooks/razorpay`;

  const existing = await client.webhooks.all();
  const already = existing.items.find((w) => w.url === webhookUrl);
  if (already) {
    console.log(`A webhook for ${webhookUrl} already exists (id: ${already.id}).`);
    console.log("Not re-creating it. Delete it in the Razorpay Dashboard first if you need a fresh secret.");
    return;
  }

  const secret = randomBytes(32).toString("hex");
  const webhook = await client.webhooks.create({
    url: webhookUrl,
    secret,
    events: [
      "subscription.activated",
      "subscription.charged",
      "subscription.cancelled",
      "subscription.halted",
      "subscription.completed",
      "subscription.expired",
    ],
  });

  console.log(`Webhook created: ${webhook.id} → ${webhookUrl}`);
  console.log("");
  console.log("Add this to .env NOW — Razorpay will not show it again:");
  console.log(`RAZORPAY_WEBHOOK_SECRET=${secret}`);
}

main().catch((error) => {
  console.error("setup-razorpay-webhook failed:", error);
  process.exit(1);
});
