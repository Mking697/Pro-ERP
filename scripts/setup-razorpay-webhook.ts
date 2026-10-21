/** Validation ONLY: no SDK, network, dotenv loading, secret generation or printing.
 * Configure webhooks manually in the appropriate Test/Live Dashboard mode.
 * Official references:
 * https://razorpay.com/docs/webhooks/setup-edit-payments
 * https://razorpay.com/docs/webhooks/validate-test
 * https://razorpay.com/docs/api/payments/subscriptions/fetch-invoices
 * https://razorpay.com/docs/api/payments/entity
 * Usage: npx tsx scripts/setup-razorpay-webhook.ts https://your-domain
 */
export function validateWebhookSetup(baseUrl: string, config: { enabled?: string; keyId?: string; keySecret?: string; webhookSecret?: string }): string[] {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Supply an HTTPS origin only.");
  if (config.enabled !== "true" || ![config.keyId, config.keySecret, config.webhookSecret].every(v => v?.trim())) throw new Error("Subscription flag and key/webhook configuration are required. Values are never printed.");
  return [
    "Local configuration validated only. No Dashboard/provider state was read or changed.",
    "In the correct Razorpay Test/Live Dashboard: Accounts & Settings > Website and app settings > Webhooks > Add New Webhook.",
    `Webhook URL: ${url.origin}/api/webhooks/razorpay`,
    "Set the same dedicated secret securely in the Dashboard and RAZORPAY_WEBHOOK_SECRET; never paste it into logs or chat.",
    "Select subscription.authenticated, subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled, subscription.completed, subscription.expired, subscription.paused, subscription.resumed, subscription.updated when available.",
    "Set an alert email and enable the webhook. Validate Test-mode charge, duplicate/reordered delivery, cancellation and paid-through behavior before any live enablement.",
    "Deploy/apply the additive subscription schema first. Keep subscriptions disabled until migration, reconciliation and delivery acceptance pass.",
    "A reserved attempt without a provider id MUST NOT be deleted/retried automatically. Reconcile Dashboard subscription notes.attemptId and orgId; bind the existing provider subscription via its webhook. If creation cannot be disproved, keep the attempt blocked.",
    "Pre-V1 subscriptions require explicit operator reconciliation to a price/key/plan-bound attempt; never silently replace an organization subscription pointer.",
    "Tenant deletion integration: delete billing_subscription_charges via attempt_id for the org BEFORE billing_subscription_attempts, then delete existing billing_payments and the organization, in the same tenant transaction. New FKs deliberately do not silently cascade historical receipts.",
  ];
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/setup-razorpay-webhook.ts")) {
  try {
    const lines = validateWebhookSetup(process.argv[2] ?? "", {
      enabled: process.env.RAZORPAY_SUBSCRIPTIONS_ENABLED,
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });
    for (const line of lines) console.log(line);
  } catch {
    console.error("Validation failed: supply an HTTPS origin and enabled subscription key/webhook configuration. No values printed; no provider changes made.");
    process.exitCode = 1;
  }
}
