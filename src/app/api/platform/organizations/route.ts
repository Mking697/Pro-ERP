import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { listOrganizations } from "@/lib/platform/registry";
import { runWithTenant } from "@/lib/tenant";
import { listUsers } from "@/lib/auth/users";
import { getPlanLimit, PLAN_NAMES } from "@/lib/platform/planLimits";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const orgs = await listOrganizations();

  // Sequential rather than parallel — this page is rare while customer traffic is not,
  // no need to fire every org's user-count read at once.
  const rows = [];
  for (const org of orgs) {
    let userCount: number | null = null;
    let error: string | null = null;

    try {
      const users = await runWithTenant({ orgId: org.id, org }, () => listUsers());
      userCount = users.filter((u) => u.Status === "Active").length;
    } catch (e) {
      error = e instanceof Error ? e.message : "Users load nahi ho paye.";
    }

    rows.push({
      orgId: org.id,
      name: org.orgName,
      slug: org.slug,
      ownerEmail: org.ownerEmail,
      plan: org.plan,
      maxActiveUsers: getPlanLimit(org.plan).maxActiveUsers,
      status: org.status,
      createdAt: org.createdAt,
      userCount,
      error,
    });
  }

  return NextResponse.json({ organizations: rows, planNames: PLAN_NAMES });
}
