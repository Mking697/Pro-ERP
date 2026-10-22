import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DB-free: /api/v1/orders's GET handler calls `withApiKeyTenant()` which rejects before
 * ever touching the tenant/db layer when the bearer key is missing/invalid — no mocking
 * of @/db/client needed for this one.
 */
describe("/api/v1/orders", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 without an Authorization header", async () => {
    vi.doMock("@/lib/apiAccess/apiKeys", () => ({ verifyApiKey: vi.fn(async () => null) }));
    vi.doMock("@/lib/rateLimit", () => ({
      checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      clientIp: vi.fn(() => "127.0.0.1"),
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantFromOrgId: vi.fn(async (orgId: string) => ({ orgId, org: { id: orgId, status: "Active" } })),
      runWithTenant: vi.fn(async (_ctx: unknown, work: () => Promise<unknown>) => work()),
      TenantResolutionError: class TenantResolutionError extends Error {},
    }));
    vi.doMock("@/lib/orders/orders", () => ({ listOrders: vi.fn(async () => []) }));

    const { GET } = await import("@/app/api/v1/orders/route");
    const response = await GET(new Request("http://localhost/api/v1/orders"));
    expect(response.status).toBe(401);
  });

  it("returns 401 for an unknown/invalid bearer key", async () => {
    vi.doMock("@/lib/apiAccess/apiKeys", () => ({ verifyApiKey: vi.fn(async () => null) }));
    vi.doMock("@/lib/rateLimit", () => ({
      checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      clientIp: vi.fn(() => "127.0.0.1"),
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantFromOrgId: vi.fn(async (orgId: string) => ({ orgId, org: { id: orgId, status: "Active" } })),
      runWithTenant: vi.fn(async (_ctx: unknown, work: () => Promise<unknown>) => work()),
      TenantResolutionError: class TenantResolutionError extends Error {},
    }));
    vi.doMock("@/lib/orders/orders", () => ({ listOrders: vi.fn(async () => []) }));

    const { GET } = await import("@/app/api/v1/orders/route");
    const response = await GET(
      new Request("http://localhost/api/v1/orders", { headers: { Authorization: "Bearer not-a-real-key" } })
    );
    expect(response.status).toBe(401);
  });

  it("returns this org's own data for a valid key, tenant-scoped", async () => {
    vi.doMock("@/lib/apiAccess/apiKeys", () => ({ verifyApiKey: vi.fn(async () => "ORG-1") }));
    vi.doMock("@/lib/rateLimit", () => ({
      checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
      clientIp: vi.fn(() => "127.0.0.1"),
    }));
    vi.doMock("@/lib/tenant", () => ({
      tenantFromOrgId: vi.fn(async (orgId: string) => ({ orgId, org: { id: orgId, status: "Active" } })),
      runWithTenant: vi.fn(async (_ctx: unknown, work: () => Promise<unknown>) => work()),
      TenantResolutionError: class TenantResolutionError extends Error {},
    }));
    vi.doMock("@/lib/orders/orders", () => ({
      listOrders: vi.fn(async () => [{ id: "ORD-1", orgId: "ORG-1" }]),
    }));

    const { GET } = await import("@/app/api/v1/orders/route");
    const response = await GET(
      new Request("http://localhost/api/v1/orders", { headers: { Authorization: "Bearer pk_live_real" } })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([{ id: "ORD-1", orgId: "ORG-1" }]);
    expect(body.total).toBe(1);
  });
});
