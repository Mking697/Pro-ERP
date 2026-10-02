import { describe, expect, it } from "vitest";
import { forEachActiveOrganization } from "@/lib/platform/runner";
import { getTenantOrgId } from "@/lib/tenant";
import { deleteOrganization } from "@/lib/platform/registry";
import { makeTestOrg } from "./helpers/testOrg";

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
    const orgs = await Promise.all([
      makeTestOrg("Concurrency-A"),
      makeTestOrg("Concurrency-B"),
      makeTestOrg("Concurrency-C"),
      makeTestOrg("Concurrency-D"),
      makeTestOrg("Concurrency-E"),
      makeTestOrg("Concurrency-F"),
    ]);
    const expectedIds = new Set(orgs.map((o) => o.id));

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

      // Only this test's own six orgs, in case other orgs already exist on this DB.
      const own = results.filter((r) => expectedIds.has(r.orgId));
      expect(own).toHaveLength(6);

      for (const r of own) {
        expect(r.ok).toBe(true);
        expect(r.result?.resolvedOrgId).toBe(r.result?.expectedOrgId);
        expect(r.result?.resolvedOrgId).toBe(r.orgId);
      }
    } finally {
      await Promise.all(orgs.map((o) => deleteOrganization(o.id).catch(() => {})));
    }
  });

  it("isolates one organization's failure from the rest, even running concurrently", async () => {
    const orgs = await Promise.all([
      makeTestOrg("Isolation-A"),
      makeTestOrg("Isolation-B"),
      makeTestOrg("Isolation-Fail"),
      makeTestOrg("Isolation-C"),
    ]);
    const expectedIds = new Set(orgs.map((o) => o.id));
    const failingOrg = orgs.find((o) => o.orgName.includes("Isolation-Fail"))!;

    try {
      const results = await forEachActiveOrganization(async (ctx) => {
        if (ctx.orgId === failingOrg.id) {
          throw new Error("Deliberate test failure");
        }
        return "ok";
      });

      const own = results.filter((r) => expectedIds.has(r.orgId));
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
      await Promise.all(orgs.map((o) => deleteOrganization(o.id).catch(() => {})));
    }
  });
});
