import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { getOrganization } from "@/lib/platform/registry";
import { getPlanLimit } from "@/lib/platform/planLimits";
import { listUsers } from "@/lib/auth/users";

/**
 * Read-only: lets an org's own Admin see their current plan + trial countdown from
 * Settings, mirroring the other single-purpose GET routes in this folder (e.g. the Logo
 * route). Changing the plan itself is still Platform-Admin-only, from `/platform` — this
 * route never accepts a PATCH.
 */
export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const orgId = await getTenantOrgId();
  const org = await getOrganization(orgId);
  if (!org) {
    return NextResponse.json({ error: "Organization nahi mila." }, { status: 404 });
  }

  const limit = getPlanLimit(org.plan);
  const activeUserCount = (await listUsers()).filter((u) => u.Status === "Active").length;

  return NextResponse.json({
    plan: org.plan,
    trialEndsAt: org.trialEndsAt,
    maxActiveUsers: limit.maxActiveUsers,
    maxCompanies: limit.maxCompanies,
    activeUserCount,
  });
}
