import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/tenant";
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), verifySession: vi.fn(), liveUser: vi.fn(), getOrganization: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE: "erp_session", verifySession: mocks.verifySession }));
vi.mock("@/db/client", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: mocks.liveUser }) }) }),
} }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: mocks.getOrganization }));
import { getTenant, runWithTenant } from "@/lib/tenant";
const session = {
  orgId: "ORG-sec01", userId: "USR-sec01", email: "user@example.com", fullName: "Test",
  role: "Admin", access: [], tokenVersion: 3,
};
const org = { id: session.orgId, status: "Active", plan: "Growth" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "signed-cookie" }) });
  mocks.verifySession.mockResolvedValue(session);
  mocks.liveUser.mockResolvedValue([{ status: "Active", tokenVersion: 3 }]);
  mocks.getOrganization.mockResolvedValue(org);
});
describe("implicit tenant authentication cannot bypass revocation", () => {
  it.each([
    ["deleted", []],
    ["inactive", [{ status: "Inactive", tokenVersion: 3 }]],
    ["wrong token version", [{ status: "Active", tokenVersion: 4 }]],
  ])("rejects %s before reading the organization", async (_reason, rows) => {
    mocks.liveUser.mockResolvedValue(rows);
    await expect(getTenant()).rejects.toThrow("koi valid session nahi hai");
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });
  it("propagates DB failure, rather than resolving a tenant", async () => {
    mocks.liveUser.mockRejectedValue(new Error("DB unavailable"));
    await expect(getTenant()).rejects.toThrow("DB unavailable");
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });
  it("preserves active-session tenant resolution", async () => {
    expect(await getTenant()).toEqual({ orgId: session.orgId, org });
    expect(mocks.liveUser).toHaveBeenCalledOnce();
    expect(mocks.cookies).toHaveBeenCalledOnce();
  });
  it("preserves missing-request-scope diagnostics", async () => {
    mocks.cookies.mockRejectedValue(new Error("No request scope"));
    await expect(getTenant()).rejects.toThrow("koi request scope nahi hai");
    expect(mocks.liveUser).not.toHaveBeenCalled();
  });
  it.each(["missing cookie", "invalid token"])("rejects %s without DB queries", async (reason) => {
    if (reason === "missing cookie") mocks.cookies.mockResolvedValue({ get: () => undefined });
    else mocks.verifySession.mockResolvedValue(null);
    await expect(getTenant()).rejects.toThrow("koi valid session nahi hai");
    expect(mocks.liveUser).not.toHaveBeenCalled();
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });
  it("keeps explicit public-share/cron tenant context independent of login", async () => {
    const context = { orgId: org.id, org } as TenantContext;
    expect(await runWithTenant(context, getTenant)).toBe(context);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.verifySession).not.toHaveBeenCalled();
    expect(mocks.liveUser).not.toHaveBeenCalled();
  });
});
