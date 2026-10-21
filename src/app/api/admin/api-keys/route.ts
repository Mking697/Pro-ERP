import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { generateApiKey, listApiKeys } from "@/lib/apiAccess/apiKeys";

/** GET /api/admin/api-keys — list this org's keys (never the hash). Admin only. */
export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const orgId = await getTenantOrgId();
  const keys = await listApiKeys(orgId);
  return NextResponse.json({ keys });
}

/** POST /api/admin/api-keys — mint a new key, returns its plaintext ONCE. Admin only. */
export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" ? body.label : "";
  if (!label.trim()) {
    return NextResponse.json({ error: "Label dena zaroori hai." }, { status: 400 });
  }

  const orgId = await getTenantOrgId();
  const key = await generateApiKey(orgId, label, guard.session.userId);
  return NextResponse.json(key);
}
