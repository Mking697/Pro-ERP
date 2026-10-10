import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn(), cache: new Map<string, unknown>() }));
vi.mock("@/db/client", async () => { const { drizzle } = await import("drizzle-orm/pg-proxy"); return { db: drizzle(async (sql, params) => m.query(sql, params)), isInTenantTransaction: () => false }; });
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-config", getTenantRequestCache: () => m.cache }));
vi.mock("@/lib/errorLog", () => ({ logError: vi.fn() }));
import { sendWhatsAppBatch } from "@/lib/chatxflow";
beforeEach(() => { vi.resetAllMocks(); m.cache.clear(); m.query.mockResolvedValue({ rows: [["ORG-config", "CHATXFLOW_API_TOKEN", "test-token"], ["ORG-config", "CHATXFLOW_BASE_URL", "https://chatxflow.online"]] }); m.fetch.mockImplementation(async () => Response.json({ success: true })); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => vi.unstubAllGlobals());
it("fifty recipient sends perform exactly one actual settings SQL query", async () => {
  expect(await sendWhatsAppBatch(Array.from({ length: 50 }, () => ({ phone: "9876543210", message: "hi" })))).toEqual({ sent: 50, failed: 0 });
  expect(m.query).toHaveBeenCalledTimes(1); expect(m.query.mock.calls[0][0]).toMatch(/from "settings" where "settings"."org_id"/); expect(m.query.mock.calls[0][1]).toEqual(["ORG-config"]);
  expect(m.fetch).toHaveBeenCalledTimes(50);
});
