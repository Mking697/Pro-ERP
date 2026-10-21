import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

vi.mock("@/lib/auth/session", () => ({ SESSION_COOKIE: "session", verifySession: vi.fn(async () => null) }));
vi.mock("@/lib/platform/usageMetrics", () => ({ recordTenantRequest: vi.fn() }));
import { proxy } from "@/proxy";

const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
beforeEach(() => vi.clearAllMocks());

it.each(["/portal/credential", "/api/webhooks/razorpay"])("allows anonymous self-authenticated route %s to reach its handler", async (path) => {
  const response = await proxy(new NextRequest(`https://example.test${path}`), event);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("location")).toBeNull();
});

it.each(["/portals", "/portal-admin", "/api/webhooks/razorpay-extra", "/api/webhooks/other", "/api/webhooks/razorpay/admin", "/api/billing/create-subscription"])("does not exempt neighboring protected route %s", async (path) => {
  const response = await proxy(new NextRequest(`https://example.test${path}`), event);
  expect(response.status).toBe(307);
  expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
});
