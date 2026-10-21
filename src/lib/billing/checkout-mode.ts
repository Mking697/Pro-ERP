/** Shared browser-safe admission/display rules. The server independently enforces admission. */
export function billingCheckoutMode(status: { subscriptionsEnabled: boolean } | null): "order" | "subscription" {
  return status?.subscriptionsEnabled === true ? "subscription" : "order";
}

export function hasOpenSubscription(status: string | null | undefined): boolean {
  return Boolean(status && !["cancelled", "completed", "expired"].includes(status));
}
