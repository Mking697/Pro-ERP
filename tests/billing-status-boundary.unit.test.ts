import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  guard: vi.fn(), getOrg: vi.fn(), tenant: vi.fn(), where: vi.fn(),
}));
vi.mock("@/lib/auth/guard", () => ({ requireRole: h.guard }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: h.getOrg }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: h.tenant }));
vi.mock("@/lib/auth/users", () => ({ listUsers: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: () => ({ from: () => ({ where: h.where }) }) } }));
import { GET } from "@/app/api/billing/status/route";

it("lets an expired-trial Admin read only their own billing status without tenant admission", async () => {
  h.guard.mockResolvedValue({ ok: true, session: { orgId: "ORG-own", role: "Admin" } });
  h.tenant.mockRejectedValue(new Error("TRIAL_EXPIRED"));
  h.getOrg.mockResolvedValue({ id: "ORG-own", plan: "Trial", status: "Active", trialEndsAt: new Date(0), billingCycle: "", planRenewsAt: null, subscriptionStatus: "" });
  h.where.mockResolvedValue([{ count: 1 }]);
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.plan).toBe("Trial");
  expect(body.activeUserCount).toBe(1);
  expect(body.subscriptionsEnabled).toBe(false);
  expect(h.getOrg).toHaveBeenCalledWith("ORG-own");
  expect(h.tenant).not.toHaveBeenCalled();
});
