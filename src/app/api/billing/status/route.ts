import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/auth/guard";
import { getOrganization } from "@/lib/platform/registry";
import { getPlanLimit, PLAN_LIMITS } from "@/lib/platform/planLimits";

/**
 * Read-only: the signed-in org's own Admin's current plan/trial/renewal state plus the
 * full tier/pricing table — everything the `/billing` page needs to render without a
 * second round trip. Mirrors `/api/admin/settings/plan`'s own shape (that route still
 * exists, unchanged, for the Settings page's read-only Plan card).
 */
export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  // Billing remains reachable after trial/paid entitlement expires. Ownership still
  // comes solely from the live Admin session, never a request-supplied organization.
  const orgId = guard.session.orgId;
  const org = await getOrganization(orgId);
  if (!org) {
    return NextResponse.json({ error: "Organization nahi mila." }, { status: 404 });
  }

  const limit = getPlanLimit(org.plan);
  const [{ count: activeUserCount }] = await db.select({ count: count() }).from(users)
    .where(and(eq(users.orgId, orgId), eq(users.status, "Active")));

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
    subscriptionsEnabled: process.env.RAZORPAY_SUBSCRIPTIONS_ENABLED === "true" &&
      Boolean(process.env.RAZORPAY_WEBHOOK_SECRET && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  });
}
