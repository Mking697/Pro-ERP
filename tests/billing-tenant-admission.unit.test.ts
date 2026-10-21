import { expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ org: vi.fn() }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: h.org }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSessionFromToken: vi.fn() }));
import { tenantFromOrgId } from "@/lib/tenant";
it("rejects an expired subscription through actual tenant admission", async () => {
  h.org.mockResolvedValue({ id: "ORG-one", orgName: "Fixture", status: "Active", plan: "Starter", razorpaySubscriptionId: "sub_one", planRenewsAt: new Date(0) });
  await expect(tenantFromOrgId("ORG-one")).rejects.toMatchObject({ digest: "BILLING_EXPIRED" });
});
