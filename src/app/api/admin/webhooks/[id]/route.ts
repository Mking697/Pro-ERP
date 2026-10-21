import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { deleteWebhookSubscription, updateWebhookSubscription, WebhookError } from "@/lib/apiAccess/webhooks";

/** PATCH /api/admin/webhooks/[id] — update url/eventTypes/isActive. Admin only. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const patch: { url?: string; eventTypes?: string[]; isActive?: boolean } = {};
  if (typeof body.url === "string") patch.url = body.url;
  if (Array.isArray(body.eventTypes)) patch.eventTypes = body.eventTypes.filter((t: unknown) => typeof t === "string");
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;

  try {
    const orgId = await getTenantOrgId();
    const updated = await updateWebhookSubscription(orgId, id, patch);
    if (!updated) return NextResponse.json({ error: "Webhook nahi mila." }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof WebhookError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

/** DELETE /api/admin/webhooks/[id] — permanently remove a subscription. Admin only. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const orgId = await getTenantOrgId();
  const deleted = await deleteWebhookSubscription(orgId, id);
  if (!deleted) return NextResponse.json({ error: "Webhook nahi mila." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
