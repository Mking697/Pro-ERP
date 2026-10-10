import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const h = vi.hoisted(() => ({ reads: vi.fn(), write: vi.fn(), transaction: false, rows: [{ key: "ORDER_STEP1_DOER", value: "DOER-A" }] }));
vi.mock("@/db/client", () => ({
  isInTenantTransaction: () => h.transaction,
  db: {
    select: () => ({ from: () => ({ where: async (predicate: Parameters<PgDialect["sqlToQuery"]>[0]) => { h.reads(new PgDialect().sqlToQuery(predicate).params[0]); return h.rows.map(row => ({ ...row })); } }) }),
    insert: () => ({ values: (value: { key: string; value: string }) => ({ onConflictDoUpdate: async () => { h.write(); h.rows = [value]; } }) }),
  },
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSessionFromToken: vi.fn() }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: vi.fn() }));
import { runWithTenant, type TenantContext } from "@/lib/tenant";
import { getAllSettings, getSetting, upsertSetting } from "@/lib/settings";
import { getOrderSetup } from "@/lib/orders/settings";
const tenant = { orgId: "ORG-A", org: { id: "ORG-A" } } as TenantContext;
beforeEach(() => { vi.clearAllMocks(); h.transaction = false; h.rows = [{ key: "ORDER_STEP1_DOER", value: "DOER-A" }]; });
it("loads all thirteen order setup fields with one settings SQL read", async () => {
  const result = await getOrderSetupOutsideScope();
  expect(result.step1Doer).toBe("DOER-A");
  expect(result.step2TatValue).toBe(4);
  expect(h.reads).toHaveBeenCalledTimes(1);
});
it("deduplicates concurrent per-key reads inside one explicit operation", async () => {
  await runWithTenant(tenant, async () => {
    expect(await Promise.all([getSetting("ORDER_STEP1_DOER"), getSetting("MISSING"), getAllSettings()])).toEqual(["DOER-A", null, { ORDER_STEP1_DOER: "DOER-A" }]);
  });
  expect(h.reads).toHaveBeenCalledTimes(1);
});
it("refreshes the request snapshot after a successful settings write", async () => {
  await runWithTenant(tenant, async () => {
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("DOER-A");
    await upsertSetting("ORDER_STEP1_DOER", "DOER-B");
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("DOER-B");
  });
  expect(h.reads).toHaveBeenCalledTimes(2);
});
it("never reuses an HTTP snapshot inside a transaction or a transaction snapshot after it", async () => {
  await runWithTenant(tenant, async () => {
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("DOER-A");
    h.transaction = true;
    h.rows = [{ key: "ORDER_STEP1_DOER", value: "TX" }];
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("TX");
    h.rows = [{ key: "ORDER_STEP1_DOER", value: "TX-CHANGED" }];
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("TX-CHANGED");
    h.transaction = false;
    h.rows = [{ key: "ORDER_STEP1_DOER", value: "COMMITTED" }];
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("COMMITTED");
  });
  expect(h.reads).toHaveBeenCalledTimes(4);
});
async function getOrderSetupOutsideScope() { return runWithTenant(tenant, getOrderSetup); }
it("isolates concurrent operations and scopes every SQL read to the owning tenant", async () => {
  const b = { orgId: "ORG-B", org: { id: "ORG-B" } } as TenantContext;
  await Promise.all([tenant, b].map(ctx => runWithTenant(ctx, async () => {
    await Promise.all([getAllSettings(), getSetting("ORDER_STEP1_DOER")]);
  })));
  expect(h.reads.mock.calls.map(call => call[0]).sort()).toEqual(["ORG-A", "ORG-B"]);
});
it("does not share snapshots across operations and does not expose mutable cache state", async () => {
  await runWithTenant(tenant, async () => {
    const all = await getAllSettings();
    all.ORDER_STEP1_DOER = "CORRUPTED";
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("DOER-A");
  });
  h.rows = [{ key: "ORDER_STEP1_DOER", value: "FRESH" }];
  expect(await runWithTenant(tenant, () => getSetting("ORDER_STEP1_DOER"))).toBe("FRESH");
  expect(h.reads).toHaveBeenCalledTimes(2);
});
it("permits a fresh retry after a settings query fails", async () => {
  h.reads.mockImplementationOnce(() => { throw new Error("read failed"); });
  await runWithTenant(tenant, async () => {
    await expect(getAllSettings()).rejects.toThrow("read failed");
    expect(await getSetting("ORDER_STEP1_DOER")).toBe("DOER-A");
  });
  expect(h.reads).toHaveBeenCalledTimes(2);
});

