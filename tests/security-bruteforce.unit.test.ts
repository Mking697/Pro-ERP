import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercise real handlers AND the real fixed-window limiter; replace persistence only.
const h = vi.hoisted(() => ({
  buckets: new Map<string, { id: string; identifier: string; count: number }>(),
  verifyPassword: vi.fn(), verifyApiKey: vi.fn(), lookup: vi.fn(), find: vi.fn(), sign: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: {
  insert: () => ({ values: (row: { id: string; identifier: string; count: number }) => ({
    onConflictDoUpdate: () => ({ returning: async () => {
      const existing = h.buckets.get(row.id);
      const stored = existing ? { ...existing, count: existing.count + 1 } : { ...row };
      h.buckets.set(row.id, stored);
      return [{ count: stored.count }];
    } }),
  }) }),
} }));
vi.mock("@/lib/platform/registry", () => ({ lookupUserOrg: h.lookup, getOrganization: vi.fn() }));
vi.mock("@/lib/auth/users", () => ({ findUserByEmail: h.find, verifyPassword: h.verifyPassword }));
vi.mock("@/lib/auth/session", () => ({ signSession: h.sign, SESSION_COOKIE: "session" }));
vi.mock("@/lib/apiAccess/apiKeys", () => ({ verifyApiKey: h.verifyApiKey }));
vi.mock("@/lib/tenant", () => ({
  TenantResolutionError: class extends Error {},
  tenantFromOrgId: async () => ({ orgId: "ORG-test", org: { orgName: "Test", slug: "test" } }),
  runWithTenant: async (_tenant: unknown, work: () => Promise<unknown>) => work(),
}));
import { POST } from "@/app/api/auth/login/route";
import { requireApiKey } from "@/lib/auth/apiKeyGuard";

const login = (email = "admin@example.test", ip = "198.51.100.1") => new Request("https://example.test/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
  body: JSON.stringify({ email, password: "wrong-password-fixture" }),
});
const api = (key: string, ip = "198.51.100.1") => new Request("https://example.test/api/v1/orders", {
  headers: { authorization: `Bearer ${key}`, "x-forwarded-for": ip },
});
const apiStatus = async (key: string, ip?: string) => {
  const result = await requireApiKey(api(key, ip));
  return result.ok ? 200 : result.response.status;
};
function expectThrottled(response: Response) {
  expect(response.status).toBe(429);
  expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
  h.buckets.clear();
  h.lookup.mockResolvedValue({ orgId: "ORG-test", status: "Active" });
  h.find.mockResolvedValue({ User_ID: "user-test", Status: "Active", Role: "Admin", Email: "admin@example.test", Full_Name: "Test", Password_Hash: "hash-fixture", Module_Access: [], Token_Version: 0 });
  h.verifyPassword.mockResolvedValue(false);
  h.verifyApiKey.mockImplementation(async (key: string) => key === "pk_live_valid-fixture" ? "ORG-test" : null);
  h.sign.mockResolvedValue("signed-fixture");
});
afterEach(() => vi.useRealTimers());

describe("login brute force", () => {
  it("allows ten wrong passwords, blocks the eleventh before password work, then resets", async () => {
    for (let n = 0; n < 10; n++) expect((await POST(login())).status).toBe(401);
    expectThrottled(await POST(login("ADMIN@example.test")));
    expect(h.verifyPassword).toHaveBeenCalledTimes(10);
    expect(h.sign).not.toHaveBeenCalled();
    expect(JSON.stringify([...h.buckets.values()])).not.toContain("wrong-password-fixture");
    vi.advanceTimersByTime(300_000);
    expect((await POST(login())).status).toBe(401);
  });
  it("does not bypass the IP cap by rotating emails", async () => {
    for (let n = 0; n < 10; n++) expect((await POST(login(`user${n}@example.test`))).status).toBe(401);
    expectThrottled(await POST(login("another@example.test")));
    expect(h.verifyPassword).toHaveBeenCalledTimes(10);
  });
  it("does not bypass the email cap by rotating IPs", async () => {
    for (let n = 0; n < 10; n++) expect((await POST(login("admin@example.test", `198.51.100.${n + 1}`))).status).toBe(401);
    expectThrottled(await POST(login("ADMIN@example.test", "203.0.113.1")));
    expect(h.verifyPassword).toHaveBeenCalledTimes(10);
  });
  it("allows an unrelated legitimate login after another bucket is exhausted", async () => {
    for (let n = 0; n < 11; n++) await POST(login());
    h.verifyPassword.mockResolvedValue(true);
    expect((await POST(login("other@example.test", "203.0.113.2"))).status).toBe(200);
    expect(h.sign).toHaveBeenCalledOnce();
  });
});

describe("API key brute force", () => {
  it("caps verification work for rotating guesses at 300/min per IP", async () => {
    for (let n = 0; n < 350; n++) await apiStatus(`pk_live_rotate-${n}`);
    expect(h.verifyApiKey).toHaveBeenCalledTimes(300);
    const result = await requireApiKey(api("pk_live_valid-fixture"));
    expect(result.ok).toBe(false);
    if (!result.ok) expectThrottled(result.response);
    expect(await apiStatus("pk_live_valid-fixture", "203.0.113.20")).toBe(200);
  });
  it("shares the invalid-attempt budget with missing or malformed authorization", async () => {
    for (let n = 0; n < 10; n++) {
      const result = await requireApiKey(new Request("https://example.test/api/v1/orders"));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(401);
    }
    const result = await requireApiKey(new Request("https://example.test/api/v1/orders", {
      headers: { authorization: "Basic malformed-fixture" },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expectThrottled(result.response);
    expect(h.verifyApiKey).not.toHaveBeenCalled();
  });
  it("throttles rotating invalid keys by IP after ten failures with Retry-After", async () => {
    for (let n = 0; n < 10; n++) expect(await apiStatus(`pk_live_wrong-${n}`)).toBe(401);
    const result = await requireApiKey(api("pk_live_wrong-eleventh"));
    expect(result.ok).toBe(false);
    if (!result.ok) expectThrottled(result.response);
    vi.advanceTimersByTime(60_000);
    expect(await apiStatus("pk_live_wrong-new-window")).toBe(401);
  });
  it("never persists plaintext bearer keys in rate-limit buckets", async () => {
    await apiStatus("pk_live_wrong-secret-fixture");
    await apiStatus("pk_live_valid-fixture");
    const persisted = JSON.stringify([...h.buckets.values()]);
    expect(persisted).not.toContain("pk_live_wrong-secret-fixture");
    expect(persisted).not.toContain("pk_live_valid-fixture");
  });
  it("keeps the separate valid-key 300/min budget across IPs", async () => {
    for (let n = 0; n < 11; n++) await apiStatus(`pk_live_wrong-${n}`);
    for (let n = 0; n < 300; n++) expect(await apiStatus("pk_live_valid-fixture", "203.0.113.2")).toBe(200);
    const result = await requireApiKey(api("pk_live_valid-fixture", "203.0.113.9"));
    expect(result.ok).toBe(false);
    if (!result.ok) expectThrottled(result.response);
    vi.advanceTimersByTime(60_000);
    expect(await apiStatus("pk_live_valid-fixture")).toBe(200);
  });
  it("does not charge successful calls to the invalid-attempt budget", async () => {
    for (let n = 0; n < 15; n++) expect(await apiStatus("pk_live_valid-fixture")).toBe(200);
    expect(await apiStatus("pk_live_wrong-first")).toBe(401);
    expect(await apiStatus("pk_live_wrong-other-ip", "203.0.113.8")).toBe(401);
  });
});
