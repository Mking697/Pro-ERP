import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { listOrganizations } from "@/lib/platform/registry";
import { runWithTenant } from "@/lib/tenant";
import { listUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const orgs = await listOrganizations();

  // Sequential, not parallel: every org's user count is a separate Sheets read against
  // one shared per-project quota, and this page is rare while customer traffic is not.
  const rows = [];
  for (const org of orgs) {
    let userCount: number | null = null;
    let error: string | null = null;

    if (org.System_Sheet_ID) {
      try {
        const users = await runWithTenant(
          { orgId: org.Org_ID, systemSheetId: org.System_Sheet_ID, org },
          () => listUsers()
        );
        userCount = users.filter((u) => u.Status === "Active").length;
      } catch (e) {
        error = e instanceof Error ? e.message : "Sheet padhi nahi ja saki.";
      }
    }

    rows.push({
      orgId: org.Org_ID,
      name: org.Org_Name,
      slug: org.Slug,
      ownerEmail: org.Owner_Email,
      plan: org.Plan,
      status: org.Status,
      createdAt: org.Created_At,
      systemSheetId: org.System_Sheet_ID,
      userCount,
      error,
    });
  }

  return NextResponse.json({ organizations: rows });
}
