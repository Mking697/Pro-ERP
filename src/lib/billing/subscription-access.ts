/** No implicit grace or permanent paid entitlement after a recurring cycle ends.
 * Existing manual/Standard Checkout accounts retain their established admission policy.
 * Trial admission is handled separately. Billing/cancellation remains reachable via
 * the live Admin session even when ordinary tenant work is locked. */
export function isSubscriptionAccessExpired(org: {
  plan: string;
  razorpaySubscriptionId?: string;
  planRenewsAt: Date | string | null;
}, now: Date = new Date()): boolean {
  if (!org.razorpaySubscriptionId || org.plan === "Trial") return false;
  if (!org.planRenewsAt) return true;
  const until = new Date(org.planRenewsAt).getTime();
  return !Number.isFinite(until) || until <= now.getTime();
}
