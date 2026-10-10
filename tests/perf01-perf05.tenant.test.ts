import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ cookie: vi.fn(), live: vi.fn(), organization: vi.fn(), settingsRead: vi.fn() }));
// React's RSC cache dispatcher is request-local. This test adapter provides that
// lifecycle explicitly; ordinary route-handler calls deliberately do not memoize.
const render = new AsyncLocalStorage<Map<unknown, unknown>>();
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  const path = await import("node:path");
  const require = createRequire(import.meta.url);
  // Exercise installed React's actual server cache, not a reimplementation.
  const react = require(path.join(path.dirname(require.resolve("react/package.json")), "react.react-server.js"));
  react.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
    getCacheForType: (factory: () => unknown) => {
      const scope = render.getStore();
      if (!scope) return factory();
      if (!scope.has(factory)) scope.set(factory, factory());
      return scope.get(factory);
    },
  };
  return react;
});
vi.mock("next/headers", () => ({ cookies: h.cookie }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSessionFromToken: h.live }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: h.organization }));
vi.mock("@/db/client", () => ({
  isInTenantTransaction: () => false,
  db: { select: () => ({ from: () => ({ where: async () => { h.settingsRead(); return [{ key: "LOGO", value: "a" }]; } }) }) },
}));
import { getTenant, getTenantOrgId, runWithTenant } from "@/lib/tenant";
import { getSetting } from "@/lib/settings";
beforeEach(() => {
  vi.clearAllMocks();
  h.cookie.mockResolvedValue({ get: () => ({ value: "TOKEN-A" }) });
  h.live.mockResolvedValue({ orgId: "ORG-A" });
  h.organization.mockImplementation(async (id: string) => ({ id, orgName: id, status: "Active", plan: "Starter" }));
});
it("deduplicates live user and organization validation inside one render request", async () => {
  await render.run(new Map(), async () => {
    const result = await Promise.all([getTenant(), getTenantOrgId(), getTenant()]);
    expect(result[1]).toBe("ORG-A");
  });
  expect(h.live).toHaveBeenCalledTimes(1);
  expect(h.organization).toHaveBeenCalledTimes(1);
});
it("shares a settings snapshot within an RSC request but never with the following request", async () => {
  for (let request = 0; request < 2; request++) {
    await render.run(new Map(), async () => {
      expect(await Promise.all([getSetting("LOGO"), getSetting("MISSING")])).toEqual(["a", null]);
    });
  }
  expect(h.settingsRead).toHaveBeenCalledTimes(2);
  expect(h.live).toHaveBeenCalledTimes(2);
  expect(h.organization).toHaveBeenCalledTimes(2);
});
it("revalidates a revoked user on the immediately following request", async () => {
  await render.run(new Map(), getTenant);
  h.live.mockResolvedValue(null);
  await expect(render.run(new Map(), getTenant)).rejects.toThrow("valid session");
  expect(h.live).toHaveBeenCalledTimes(2);
  expect(h.organization).toHaveBeenCalledTimes(1);
});
it("does not memoize ordinary route calls without an explicit lifecycle", async () => {
  await getTenant();
  h.live.mockResolvedValue(null);
  await expect(getTenant()).rejects.toThrow("valid session");
  expect(h.live).toHaveBeenCalledTimes(2);
});
it("isolates concurrently resolving render requests for different tenants", async () => {
  h.cookie.mockImplementation(async () => ({ get: () => ({ value: render.getStore()?.get("token") }) }));
  h.live.mockImplementation(async (token: string) => ({ orgId: token }));
  const result = await Promise.all(["ORG-A", "ORG-B"].map(orgId =>
    render.run(new Map<unknown, unknown>([["token", orgId]]), async () => Promise.all([getTenantOrgId(), getTenantOrgId()]))
  ));
  expect(result).toEqual([["ORG-A", "ORG-A"], ["ORG-B", "ORG-B"]]);
  expect(h.live).toHaveBeenCalledTimes(2);
  expect(h.organization).toHaveBeenCalledTimes(2);
});
it("keeps explicit tenant scopes isolated and restores implicit resolution", async () => {
  const a = { orgId: "ORG-A", org: { id: "ORG-A" } } as Awaited<ReturnType<typeof getTenant>>;
  const b = { orgId: "ORG-B", org: { id: "ORG-B" } } as Awaited<ReturnType<typeof getTenant>>;
  expect(await Promise.all([runWithTenant(a, getTenantOrgId), runWithTenant(b, getTenantOrgId)])).toEqual(["ORG-A", "ORG-B"]);
  expect(h.live).not.toHaveBeenCalled();
  expect(await getTenantOrgId()).toBe("ORG-A");
  expect(h.live).toHaveBeenCalledTimes(1);
});
it("rejects a suspended organization before caching any allowed tenant", async () => {
  h.organization.mockResolvedValue({ id: "ORG-A", orgName: "A", status: "Suspended" });
  await expect(render.run(new Map(), getTenant)).rejects.toMatchObject({ digest: "ORG_SUSPENDED" });
});

