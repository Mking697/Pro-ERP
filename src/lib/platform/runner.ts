import { listOrganizations } from "@/lib/platform/registry";
import { runWithTenant, type TenantContext } from "@/lib/tenant";

export interface OrgRunResult<T> {
  orgId: string;
  orgName: string;
  ok: boolean;
  result?: T;
  error?: string;
}

/**
 * Runs the same work once per active organization — the shape every cron job needs,
 * since a scheduled run belongs to no single logged-in tenant.
 *
 * Deliberately sequential. Every org's sheet calls share one service account and so one
 * per-project rate limit; firing all tenants at once would burst straight into 429s and
 * make the nightly job fail for everyone rather than run a little slower.
 *
 * One organization's failure (a disconnected sheet, revoked access) is captured and
 * reported, never allowed to abort the remaining tenants' runs.
 */
export async function forEachActiveOrganization<T>(
  fn: (ctx: TenantContext) => Promise<T>
): Promise<OrgRunResult<T>[]> {
  const orgs = await listOrganizations();
  const results: OrgRunResult<T>[] = [];

  for (const org of orgs) {
    if (org.Status !== "Active" || !org.System_Sheet_ID) continue;

    const ctx: TenantContext = {
      orgId: org.Org_ID,
      systemSheetId: org.System_Sheet_ID,
      org,
    };

    try {
      const result = await runWithTenant(ctx, () => fn(ctx));
      results.push({ orgId: org.Org_ID, orgName: org.Org_Name, ok: true, result });
    } catch (error) {
      results.push({
        orgId: org.Org_ID,
        orgName: org.Org_Name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
