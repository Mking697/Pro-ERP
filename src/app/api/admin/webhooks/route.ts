import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { createWebhookSubscription, listWebhookSubscriptions, WebhookError } from "@/lib/apiAccess/webhooks";

/** GET /api/admin/webhooks — list this org's webhook subscriptions (never the secret).
 * Admin only. */
export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const orgId = await getTenantOrgId();
  const webhooks = await listWebhookSubscriptions(orgId);
  return NextResponse.json({ webhooks });
}

/** POST /api/admin/webhooks — create a subscription, returns its signing secret ONCE.
 * Admin only. */
export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : "";
  const eventTypes = Array.isArray(body.eventTypes) ? body.eventTypes.filter((t: unknown) => typeof t === "string") : [];

  try {
    const orgId = await getTenantOrgId();
    const webhook = await createWebhookSubscription(orgId, { url, eventTypes }, guard.session.userId);
    return NextResponse.json(webhook);
  } catch (error) {
    if (error instanceof WebhookError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
