import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), guard: vi.fn(), tenant: vi.fn() }));
vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(async (sql, params) => m.query(sql, params)) };
});
vi.mock("@/lib/auth/guard", () => ({ requireSession: m.guard }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: m.tenant }));
// Any legacy full-list path is a regression, not a simulated query.
vi.mock("@/lib/parties/customers", () => ({ listCustomers: () => { throw Error("full list forbidden"); } }));
vi.mock("@/lib/parties/vendors", () => ({ listVendors: () => { throw Error("full list forbidden"); } }));
vi.mock("@/lib/orders/orders", () => ({ listOrders: () => { throw Error("full list forbidden"); } }));
vi.mock("@/lib/inventory/items", () => ({ listItems: () => { throw Error("full list forbidden"); } }));
vi.mock("@/lib/leads/leads", () => ({ listLeads: () => { throw Error("full list forbidden"); } }));
import { GET } from "@/app/api/search/route";
beforeEach(() => { vi.resetAllMocks(); m.query.mockResolvedValue({ rows: [] }); m.tenant.mockResolvedValue("ORG-search"); m.guard.mockResolvedValue({ ok: true, session: { access: ["PARTY_MASTER", "ORDER_FMS", "INVENTORY_VIEW", "LEAD_FMS"] } }); });
it("issues exactly five tenant-filtered thin bounded SQL projections, no detail hydration", async () => {
  await GET(new Request("https://example/api/search?q=needle"));
  expect(m.query).toHaveBeenCalledTimes(5);
  for (const [sql, params] of m.query.mock.calls) {
    expect(sql).toMatch(/where.*org_id.*ilike/); expect(sql).toMatch(/order by/); expect(sql).toMatch(/limit/);
    expect(sql).not.toMatch(/bank_account|billing_address|order_items|lead_activities/);
    expect(params).toContain("ORG-search"); expect(params).toContain("%needle%"); expect(params).toContain(7);
  }
});
it("does not execute denied modules or tiny searches", async () => {
  m.guard.mockResolvedValue({ ok: true, session: { access: ["INVENTORY_VIEW"] } });
  await GET(new Request("https://example/api/search?q=ab"));
  expect(m.query).toHaveBeenCalledTimes(1); expect(m.query.mock.calls[0][0]).toContain('from "items"');
  await GET(new Request("https://example/api/search?q=a")); expect(m.query).toHaveBeenCalledTimes(1);
});
it("uses stable SQL offsets and escapes literal LIKE wildcard input", async () => {
  await GET(new Request("https://example/api/search?q=a%25_&page=2"));
  for (const [sql, params] of m.query.mock.calls) {
    expect(sql).toMatch(/offset/); expect(params).toContain(12); expect(params).toContain("%a\\%\\_%");
  }
});
it("returns six rows per kind with a lookahead page indicator", async () => {
  m.guard.mockResolvedValue({ ok: true, session: { access: ["INVENTORY_VIEW"] } });
  m.query.mockResolvedValue({ rows: Array.from({ length: 7 }, (_, i) => [`SKU-${i}`, `Item ${i}`]) });
  const body = await (await GET(new Request("https://example/api/search?q=ab"))).json();
  expect(body.results).toHaveLength(6); expect(body.hasMore).toBe(true); expect(body.page).toBe(0);
});
