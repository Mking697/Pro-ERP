import { afterEach, expect, vi } from "vitest";
import * as registry from "@/lib/platform/registry";

const h = vi.hoisted(() => ({
  sentinelId: "sentinel-unrelated-tenant",
  callbacks: [] as string[],
  created: 0,
  orgs: [{ id: "sentinel-unrelated-tenant", orgName: "Unrelated", status: "Active", plan: "Growth", trialEndsAt: null }] as Record<string, unknown>[],
}));

// No database modules are imported. Only the registry persistence boundary is fake.
vi.mock("@/lib/platform/registry", () => ({
  listOrganizations: vi.fn(async () => h.orgs),
  getOrganization: vi.fn(async (id: string) => h.orgs.find((org) => org.id === id) ?? null),
  createOrganization: vi.fn(async ({ orgName }: { orgName: string }) => {
    const org = { id: `fixture-${++h.created}`, orgName, status: "Active", plan: "Growth", trialEndsAt: null };
    h.orgs.push(org);
    return org;
  }),
  deleteOrganization: vi.fn(async (id: string) => {
    h.orgs = h.orgs.filter((org) => org.id !== id);
  }),
}));
vi.mock("@/lib/auth/live-session", () => ({
  getLiveSessionFromToken: vi.fn(() => { throw new Error("Unexpected implicit session lookup"); }),
}));
vi.mock("@/lib/tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>();
  return {
    ...actual,
    runWithTenant: <T>(ctx: import("@/lib/tenant").TenantContext, fn: () => Promise<T>) =>
      actual.runWithTenant(ctx, async () => {
        h.callbacks.push(ctx.orgId);
        return fn();
      }),
  };
});

afterEach(async () => {
  try {
    expect(h.callbacks, "unrelated tenant callback must never run").not.toContain(h.sentinelId);
    expect(h.orgs.map((org) => org.id), "all created fixtures must be cleaned up").toEqual([h.sentinelId]);
    expect((await registry.listOrganizations()).map((org) => org.id), "enumeration spy must be restored").toEqual([h.sentinelId]);
    expect(h.callbacks.length).toBeGreaterThan(0);
  } finally {
    h.callbacks = [];
  }
});

// Exercise the exact real-runner regression tests with fake persistence only;
// production runner, tenant admission and AsyncLocalStorage behavior remain real.
await import("./runner-concurrency.test");
