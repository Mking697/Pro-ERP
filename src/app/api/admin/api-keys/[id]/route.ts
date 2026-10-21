import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { revokeApiKey } from "@/lib/apiAccess/apiKeys";

/** DELETE /api/admin/api-keys/[id] — revoke (never hard-delete) one of this org's own
 * keys. Admin only. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const orgId = await getTenantOrgId();
  const revoked = await revokeApiKey(orgId, id);
  if (!revoked) {
    return NextResponse.json({ error: "Key nahi mili ya already revoked hai." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
