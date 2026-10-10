import { listOrganizations } from "@/lib/platform/registry";
import { runWithTenant, tenantFromOrgId, type TenantContext } from "@/lib/tenant";

export interface OrgRunResult<T> {
  orgId: string;
  orgName: string;
  ok: boolean;
  result?: T;
  error?: string;
}

// How many organizations' work runs concurrently. Unbounded Promise.all over every active
// org would fire that many simultaneous requests at Neon's HTTP endpoint at once — fine at
// today's org count, but a genuinely large platform could trip Neon's own per-connection/
// rate limits or just create a thundering-herd spike. A fixed-size pool bounds that without
// losing most of the benefit: these jobs run once daily and have no human waiting on them,
// so trading a little parallelism for safety margin costs nothing real.
const CONCURRENCY = 10;

/**
 * Runs the same work once per active organization — the shape every cron job needs,
 * since a scheduled run belongs to no single logged-in tenant.
 *
 * Parallelized with a bounded worker pool (see CONCURRENCY above) rather than fully
 * sequential — the original forcing reason (every org's Sheets calls sharing one Google
 * service account's per-project rate limit) is gone post-migration, and CLAUDE.md's own
 * working notes flagged this as worth revisiting once org count or run frequency grew.
 * Tenant isolation during concurrent runs is real, not assumed: `runWithTenant()` uses
 * `AsyncLocalStorage`, which gives each concurrent async call chain its own independent
 * context — two organizations' work running at the same instant can never see or leak into
 * each other's `getTenant()`/`getTenantOrgId()` resolution, confirmed by reading
 * `src/lib/tenant.ts`'s own implementation before relying on this, not assumed from the
 * primitive's name alone.
 *
 * One organization's failure (a disconnected sheet, revoked access, a bad query) is still
 * captured and reported per-org, never allowed to abort any other tenant's run — a pool
 * worker's own try/catch is exactly as isolating as the old sequential loop's was, just
 * running several at once instead of one at a time.
 */
export async function forEachActiveOrganization<T>(
  fn: (ctx: TenantContext) => Promise<T>
): Promise<OrgRunResult<T>[]> {
  const orgs = (await listOrganizations()).filter((org) => org.status === "Active");
  const results: OrgRunResult<T>[] = new Array(orgs.length);

  async function runOne(index: number): Promise<void> {
    const org = orgs[index];

    try {
      // Resolves through the exact same check the interactive request path already goes
      // through (getTenant() -> tenantFromOrgId()) instead of building the tenant context
      // directly off the raw listOrganizations() row. POLICY DECISION (documented,
      // conservative, overridable — not a silent guess): a background/cron run for an org
      // whose trial has expired must not silently keep generating new business records
      // (e.g. new recurring task occurrences) the way an active org's does. This file
      // used to only filter on `org.status === "Active"`, which says nothing about trial
      // expiry — an org can stay "Active" status-wise for its whole expired trial, so
      // cron kept running for it even though every interactive request from that org was
      // already being hard-blocked with TRIAL_EXPIRED. tenantFromOrgId() throws the same
      // TenantResolutionError for that case here, which the catch below turns into an
      // ordinary per-org failure — this org's generation is skipped entirely for the run,
      // never aborting any other tenant's, exactly like any other org-specific error.
      // A different business choice — e.g. continue generating but mark the result
      // read-only — remains a valid alternative; this is the one place to change if the
      // business picks that instead.
      const ctx = await tenantFromOrgId(org.id);
      const result = await runWithTenant(ctx, () => fn(ctx));
      results[index] = { orgId: org.id, orgName: org.orgName, ok: true, result };
    } catch (error) {
      results[index] = {
        orgId: org.id,
        orgName: org.orgName,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // A fixed-size pool of workers, each pulling the next not-yet-started index until none
  // are left — simpler than chunking into batches of CONCURRENCY (which would let a single
  // slow org in one batch hold up the next batch's otherwise-fast orgs for no reason).
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < orgs.length) {
      const index = nextIndex++;
      await runOne(index);
    }
  }
  const workerCount = Math.min(CONCURRENCY, orgs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
