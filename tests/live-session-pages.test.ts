import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(), verifySession: vi.fn(), liveUser: vi.fn(),
  getItemDetail: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "erp_session", verifySession: mocks.verifySession,
}));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.liveUser }) }) }) },
}));
vi.mock("@/components/app-shell", () => ({ default: () => null }));
vi.mock("@/components/charts", () => ({ TimelineChart: () => null, ChartFrame: () => null }));
vi.mock("@/lib/inventory/service", () => ({ getItemDetail: mocks.getItemDetail }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (key: string) => key }));

import ItemDetailPage from "@/app/inventory/[sku]/page";
import { GET as getMe } from "@/app/api/auth/me/route";
import { getLiveSession } from "@/lib/auth/live-session";

const session: SessionPayload = {
  orgId: "ORG-sec01", userId: "USR-sec01", email: "user@example.com",
  fullName: "Test User", role: "Admin", access: ["INVENTORY_VIEW"], tokenVersion: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "signed-cookie" }) });
  mocks.verifySession.mockResolvedValue(session);
  mocks.liveUser.mockResolvedValue([{ status: "Active", tokenVersion: 3 }]);
  mocks.getItemDetail.mockResolvedValue(null);
});

describe("shared live session edge cases", () => {
  it("accepts the unchanged active account", async () => {
    expect(await getLiveSession()).toEqual(session);
  });
  it("does not query the database without a cookie", async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    expect(await getLiveSession()).toBeNull();
    expect(mocks.verifySession).not.toHaveBeenCalled();
    expect(mocks.liveUser).not.toHaveBeenCalled();
  });
  it("does not query the database for an invalid token", async () => {
    mocks.verifySession.mockResolvedValue(null);
    expect(await getLiveSession()).toBeNull();
    expect(mocks.liveUser).not.toHaveBeenCalled();
  });
  it("propagates database failure without authenticated data reads", async () => {
    mocks.liveUser.mockRejectedValue(new Error("DB unavailable"));
    await expect(ItemDetailPage({ params: Promise.resolve({ sku: "SKU-test" }) }))
      .rejects.toThrow("DB unavailable");
    expect(mocks.getItemDetail).not.toHaveBeenCalled();
  });
});

describe("auth/me uses live revocation", () => {
  it.each([
    ["deleted", []],
    ["inactive", [{ status: "Inactive", tokenVersion: 3 }]],
    ["wrong token version", [{ status: "Active", tokenVersion: 4 }]],
  ])("does not disclose a %s session", async (_reason, rows) => {
    mocks.liveUser.mockResolvedValue(rows);
    expect(await (await getMe()).json()).toEqual({ user: null });
  });
  it("fails closed on database errors", async () => {
    mocks.liveUser.mockRejectedValue(new Error("DB unavailable"));
    await expect(getMe()).rejects.toThrow("DB unavailable");
  });
  it("preserves active-account response", async () => {
    expect(await (await getMe()).json()).toEqual({ user: session });
  });
  it.each(["missing cookie", "invalid token"])("returns null for %s without DB reads", async (reason) => {
    if (reason === "missing cookie") mocks.cookies.mockResolvedValue({ get: () => undefined });
    else mocks.verifySession.mockResolvedValue(null);
    expect(await (await getMe()).json()).toEqual({ user: null });
    expect(mocks.liveUser).not.toHaveBeenCalled();
  });
});

describe("inventory server read checks the live account before data access", () => {
  it.each([
    ["deleted", []],
    ["inactive", [{ status: "Inactive", tokenVersion: 3 }]],
    ["revoked or stale permissions", [{ status: "Active", tokenVersion: 4 }]],
  ])("rejects a %s account even with a valid signed cookie", async (_reason, rows) => {
    mocks.liveUser.mockResolvedValue(rows);
    await expect(ItemDetailPage({ params: Promise.resolve({ sku: "SKU-test" }) }))
      .rejects.toThrow("REDIRECT:/login");
    expect(mocks.getItemDetail).not.toHaveBeenCalled();
  });
});
