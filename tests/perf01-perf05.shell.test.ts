import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ registry: vi.fn(), tenant: vi.fn(), scope: null as null | { orgId: string }, nav: vi.fn(), used: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  getTenant: h.tenant,
  runWithTenant: async (ctx: { orgId: string }, work: () => Promise<unknown>) => {
    h.scope = ctx;
    try { return await work(); } finally { h.scope = null; }
  },
}));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: h.registry }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => { expect(h.scope?.orgId).toBe("ORG-A"); return "logo"; } }));
vi.mock("@/lib/fms/templates", () => ({ listNavFmsTemplates: async () => { h.nav(); expect(h.scope?.orgId).toBe("ORG-A"); return []; } }));
vi.mock("@/lib/inventory/plans", () => ({ listUsedFmsTemplateIds: async () => { h.used(); expect(h.scope?.orgId).toBe("ORG-A"); return new Set(); } }));
vi.mock("@/components/sidebar-shell", () => ({ default: () => null }));
vi.mock("@/lib/platform/admin", () => ({ isPlatformAdmin: () => false }));
import AppShell from "@/components/app-shell";
import type { SessionPayload } from "@/lib/auth/session";
const session = { orgId: "ORG-A", userId: "USER-A", access: [], role: "Admin", email: "test@example.com" } as unknown as SessionPayload;
beforeEach(() => { vi.clearAllMocks(); h.scope = null; h.tenant.mockResolvedValue({ orgId: "ORG-A", org: { id: "ORG-A", orgName: "Validated" } }); });
it("rejects a navigation session whose organization differs from the validated tenant", async () => {
  h.tenant.mockResolvedValue({ orgId: "ORG-B", org: { id: "ORG-B", orgName: "B" } });
  await expect(AppShell({ session, children: null })).rejects.toThrow("Tenant/session mismatch");
  expect(h.nav).not.toHaveBeenCalled();
});
it("reuses the validated organization and scopes navigation reads without a global TTL", async () => {
  const shell = await AppShell({ session, children: null });
  expect(shell.props.orgName).toBe("Validated");
  expect(h.registry).not.toHaveBeenCalled();
  await AppShell({ session, children: null });
  expect(h.nav).toHaveBeenCalledTimes(2);
  expect(h.used).toHaveBeenCalledTimes(2);
});
