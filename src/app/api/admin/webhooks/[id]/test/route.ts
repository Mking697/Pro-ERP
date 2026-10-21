import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { sendTestPing, WebhookError } from "@/lib/apiAccess/webhooks";

/** POST /api/admin/webhooks/[id]/test — sends a synthetic `test.ping` event straight to
 * the receiver so the Admin can confirm connectivity without waiting for a real event.
 * Admin only. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  try {
    const orgId = await getTenantOrgId();
    const result = await sendTestPing(orgId, id);
    return NextResponse.json({ delivered: result.ok, status: result.status, bodySnippet: result.bodySnippet });
  } catch (error) {
    if (error instanceof WebhookError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
