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
 * Deliberately sequential. This was originally forced by every org's Sheets calls sharing
 * one Google service account's per-project rate limit — now that persistence is Postgres,
 * that specific constraint is gone (no shared external rate limit across tenants). Kept
 * sequential anyway for simplicity and easy per-org error isolation; these jobs run once
 * daily, so there's no latency pressure to parallelize. Revisit if a future cron job needs
 * to run much more frequently or against many more organizations.
 *
 * One organization's failure (a disconnected sheet, revoked access, a bad query) is
 * captured and reported, never allowed to abort the remaining tenants' runs.
 */
export async function forEachActiveOrganization<T>(
  fn: (ctx: TenantContext) => Promise<T>
): Promise<OrgRunResult<T>[]> {
  const orgs = await listOrganizations();
  const results: OrgRunResult<T>[] = [];

  for (const org of orgs) {
    if (org.status !== "Active") continue;

    const ctx: TenantContext = { orgId: org.id, org };

    try {
      const result = await runWithTenant(ctx, () => fn(ctx));
      results.push({ orgId: org.id, orgName: org.orgName, ok: true, result });
    } catch (error) {
      results.push({
        orgId: org.id,
        orgName: org.orgName,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
