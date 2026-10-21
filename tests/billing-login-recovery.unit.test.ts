import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  lookup: vi.fn(), org: vi.fn(), resolve: vi.fn(), find: vi.fn(), verify: vi.fn(), sign: vi.fn(),
}));
vi.mock("@/lib/platform/registry", () => ({ lookupUserOrg: h.lookup, getOrganization: h.org }));
vi.mock("@/lib/auth/users", () => ({ findUserByEmail: h.find, verifyPassword: h.verify }));
vi.mock("@/lib/auth/session", () => ({ signSession: h.sign, SESSION_COOKIE: "session" }));
vi.mock("@/lib/tenant", () => ({
  TenantResolutionError: class extends Error { constructor(message: string, public digest?: string) { super(message); } },
  tenantFromOrgId: h.resolve,
  runWithTenant: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => ({ allowed: true }), clientIp: () => "fixture" }));
import { TenantResolutionError } from "@/lib/tenant";
import { POST } from "@/app/api/auth/login/route";
const request = () => new Request("https://example.test/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.test", password: "fixture-only" }) });
beforeEach(() => {
  vi.clearAllMocks();
  h.lookup.mockResolvedValue({ orgId: "ORG-own", status: "Active" });
  h.resolve.mockRejectedValue(new TenantResolutionError("Expired", "TRIAL_EXPIRED"));
  h.org.mockResolvedValue({ id: "ORG-own", orgName: "Fixture", slug: "fixture", status: "Active" });
  h.find.mockResolvedValue({ User_ID: "one", Status: "Active", Role: "Admin", Email: "admin@example.test", Full_Name: "Fixture", Password_Hash: "fixture", Module_Access: [], Token_Version: 0 });
  h.verify.mockResolvedValue(true);
  h.sign.mockResolvedValue("fixture-signed-token");
});
it("lets a credential-verified expired-trial Admin log in for billing only", async () => {
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect((await result.json()).redirectTo).toBe("/billing");
  expect(h.verify).toHaveBeenCalled();
});
it("never issues a billing session when the password is incorrect", async () => {
  h.verify.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(401);
  expect(h.sign).not.toHaveBeenCalled();
});
it("does not bypass an administrative suspension", async () => {
  h.resolve.mockRejectedValue(new TenantResolutionError("Suspended", "ORG_SUSPENDED"));
  expect((await POST(request())).status).toBe(403);
  expect(h.sign).not.toHaveBeenCalled();
});
