import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { getOrganization } from "@/lib/platform/registry";
import { getPlanLimit, PLAN_LIMITS } from "@/lib/platform/planLimits";
import { listUsers } from "@/lib/auth/users";

/**
 * Read-only: the signed-in org's own Admin's current plan/trial/renewal state plus the
 * full tier/pricing table — everything the `/billing` page needs to render without a
 * second round trip. Mirrors `/api/admin/settings/plan`'s own shape (that route still
 * exists, unchanged, for the Settings page's read-only Plan card).
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
    billingCycle: org.billingCycle,
    trialEndsAt: org.trialEndsAt,
    planRenewsAt: org.planRenewsAt,
    maxActiveUsers: limit.maxActiveUsers,
    maxCompanies: limit.maxCompanies,
    activeUserCount,
    tiers: PLAN_LIMITS,
    subscriptionStatus: org.subscriptionStatus,
  });
}
