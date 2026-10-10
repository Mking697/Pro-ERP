import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ liveSession: vi.fn(), getOrganization: vi.fn() }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSession: mocks.liveSession }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "signed-cookie" }) }) }));
vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE: "erp_session", verifySession: async () => session }));
// This route guard must not contain a second implementation or DB read.
vi.mock("@/db/client", () => ({ db: { select: () => { throw new Error("DUPLICATE_AUTH_QUERY"); } } }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: mocks.getOrganization }));
import { requireSession, requireModule, requireRole, requireAnyModule } from "@/lib/auth/guard";
const session = {
  orgId: "ORG-sec01", userId: "USR-sec01", email: "user@example.com", fullName: "Test",
  role: "Admin", access: ["AI_CHATBOT"], tokenVersion: 3,
};
const org = { id: session.orgId, status: "Active", plan: "Growth" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.liveSession.mockResolvedValue(session);
  mocks.getOrganization.mockResolvedValue(org);
});
describe("API guards share live-session validation", () => {
  it("returns the active shared session without duplicate auth reads", async () => {
    expect(await requireSession()).toEqual({ ok: true, session });
    expect(mocks.liveSession).toHaveBeenCalledOnce();
  });
  it("returns 401 when the shared helper rejects the cookie", async () => {
    mocks.liveSession.mockResolvedValue(null);
    const result = await requireSession();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
  it("propagates helper/DB errors without granting access", async () => {
    mocks.liveSession.mockRejectedValue(new Error("DB unavailable"));
    await expect(requireSession()).rejects.toThrow("DB unavailable");
  });
  it("retains ModuleGuardResult tenant used by chatbot request context", async () => {
    expect(await requireModule("AI_CHATBOT")).toEqual({ ok: true, session, tenant: { orgId: org.id, org } });
    expect(mocks.getOrganization).toHaveBeenCalledOnce();
    expect(mocks.liveSession).toHaveBeenCalledOnce();
  });
  it("preserves role and module rejection", async () => {
    expect((await requireRole(["Doer"])).ok).toBe(false);
    expect((await requireAnyModule(["INVENTORY_VIEW"])).ok).toBe(false);
  });
});
