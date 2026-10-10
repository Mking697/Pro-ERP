import { describe, expect, it, vi } from "vitest";
import { forEachActiveOrganization } from "@/lib/platform/runner";
import { getTenantOrgId } from "@/lib/tenant";
import * as registry from "@/lib/platform/registry";
import { makeTestOrgs, cleanupTestOrgs } from "./helpers/testOrg";

/**
 * forEachActiveOrganization() was parallelized (bounded worker pool, CONCURRENCY=10 in
 * src/lib/platform/runner.ts) after being sequential since the Postgres migration — the
 * two properties that mattered about the sequential version must still hold true now that
 * several orgs' work runs at the same instant:
 *
 *   1. Tenant isolation — one org's callback must never resolve another org's orgId via
 *      getTenant()/getTenantOrgId(), even while running concurrently with it. This is the
 *      one a careless parallelization could get wrong (e.g. a shared mutable "current
 *      org" variable instead of AsyncLocalStorage's own per-call-chain context).
 *   2. Per-org error isolation — one org's callback throwing must not abort or corrupt any
 *      other org's result, and the failing org's own `ok:false`/`error` must still come
 *      back correctly (this property already had its own correctness bar under the old
 *      sequential loop; parallelizing must not regress it).
 *
 * Seeds enough throwaway orgs to exceed CONCURRENCY=1 pool width in a meaningful way (more
 * than one worker definitely runs at once), has every org's own callback read back its own
 * orgId via getTenantOrgId() and assert it matches what it was called for, and makes one
 * specific org's callback throw to prove isolation holds both ways.
 */
describe("forEachActiveOrganization concurrency", () => {
  it("never leaks tenant context across concurrently-running organizations", async () => {
    const orgs = await makeTestOrgs([
      "Concurrency-A", "Concurrency-B", "Concurrency-C",
      "Concurrency-D", "Concurrency-E", "Concurrency-F",
    ]);
    // Restrict enumeration BEFORE any callback; never run work for unrelated tenants.
    // getOrganization/tenantFromOrgId and AsyncLocalStorage remain the real code path.
    const enumeration = vi.spyOn(registry, "listOrganizations").mockResolvedValue(orgs);

    try {
      const results = await forEachActiveOrganization(async (ctx) => {
        // A real artificial delay, staggered per org, so the pool genuinely overlaps
        // several callbacks in flight at once rather than them all finishing instantly
        // before the next one even starts (which would make this test pass even with a
        // correctness bug, by accident of timing).
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30));
        // The actual isolation check: resolve "which org am I" through the real
        // production code path (getTenantOrgId(), not ctx.orgId handed back unchanged)
        // — this is what would catch a shared-state bug a naive parallelization could
        // introduce (e.g. a single mutable "current tenant" variable instead of
        // AsyncLocalStorage's own per-call-chain isolation).
        const resolvedOrgId = await getTenantOrgId();
        return { expectedOrgId: ctx.orgId, resolvedOrgId };
      });

      const own = results;
      expect(own.map((r) => r.orgId)).toEqual(orgs.map((org) => org.id));
      expect(own).toHaveLength(6);

      for (const r of own) {
        expect(r.ok).toBe(true);
        expect(r.result?.resolvedOrgId).toBe(r.result?.expectedOrgId);
        expect(r.result?.resolvedOrgId).toBe(r.orgId);
      }
    } finally {
      enumeration.mockRestore();
      await cleanupTestOrgs(orgs);
    }
  });

  it("isolates one organization's failure from the rest, even running concurrently", async () => {
    const orgs = await makeTestOrgs([
      "Isolation-A", "Isolation-B", "Isolation-Fail", "Isolation-C",
    ]);
    const enumeration = vi.spyOn(registry, "listOrganizations").mockResolvedValue(orgs);
    const failingOrg = orgs.find((o) => o.orgName.includes("Isolation-Fail"))!;

    try {
      const results = await forEachActiveOrganization(async (ctx) => {
        if (ctx.orgId === failingOrg.id) {
          throw new Error("Deliberate test failure");
        }
        return "ok";
      });

      const own = results;
      expect(own.map((r) => r.orgId)).toEqual(orgs.map((org) => org.id));
      expect(own).toHaveLength(4);

      const failed = own.find((r) => r.orgId === failingOrg.id);
      expect(failed?.ok).toBe(false);
      expect(failed?.error).toContain("Deliberate test failure");

      const succeeded = own.filter((r) => r.orgId !== failingOrg.id);
      expect(succeeded).toHaveLength(3);
      for (const r of succeeded) {
        expect(r.ok).toBe(true);
        expect(r.result).toBe("ok");
      }
    } finally {
      enumeration.mockRestore();
      await cleanupTestOrgs(orgs);
    }
  });
});
