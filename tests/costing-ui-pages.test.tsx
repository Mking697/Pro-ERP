import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), tenant: vi.fn(), get: vi.fn(), connection: vi.fn() }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); }, notFound: () => { throw new Error("404"); } }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSession: mocks.session }));
vi.mock("@/lib/tenant", () => ({ tenantFromOrgId: mocks.tenant, runWithTenant: async (_ctx: unknown, fn: () => unknown) => fn() }));
vi.mock("@/lib/costing/service", () => ({ getProductCostSheet: mocks.get }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (s: string) => s }));
vi.mock("@/components/app-shell", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/app/cost-sheets/cost-sheets-board", () => ({ default: () => null }));
vi.mock("@/app/cost-sheets/snapshot", () => ({ default: () => null }));
import Page from "@/app/cost-sheets/page";
import PrintPage from "@/app/cost-sheets/[id]/print/page";
beforeEach(() => { vi.clearAllMocks(); mocks.tenant.mockResolvedValue({ orgId: "org" }); });
it.each([null, { orgId: "org", userId: "u", access: [] }])("main page denies missing live grant before tenant/data reads: %s", async session => {
  mocks.session.mockResolvedValue(session);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(session ? "/dashboard" : "/login");
  expect(mocks.tenant).not.toHaveBeenCalled();
});
it.each([null, { orgId: "org", userId: "u", access: [] }])("print page denies before snapshot read: %s", async session => {
  mocks.session.mockResolvedValue(session);
  await expect(PrintPage({ params: Promise.resolve({ id: "secret" }) })).rejects.toThrow(session ? "/dashboard" : "/login");
  expect(mocks.get).not.toHaveBeenCalled();
});
it("main page keys client by identity/grants and passes server IST date plus exact product SKU", async () => {
  mocks.session.mockResolvedValue({ orgId: "org", userId: "u", access: ["COST_SHEETS"] });
  const element = await Page({ searchParams: Promise.resolve({ productSku: "FG / exact" }) });
  const board = element.props.children.props.children[1];
  expect(board.key).toContain("org:u:COST_SHEETS");
  expect(board.props.initialProductSku).toBe("FG / exact");
  expect(board.props.initialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
it("print renders the exact saved DTO without preview or repricing", async () => {
  const saved = { id: "saved / exact", calculation: { productSku: "FG" }, version: 4, status: "Finalized" };
  mocks.session.mockResolvedValue({ orgId: "org", userId: "u", access: ["COST_SHEETS"] });
  mocks.get.mockResolvedValue(saved);
  const element = await PrintPage({ params: Promise.resolve({ id: "saved / exact" }) });
  const snapshot = element.props.children[1];
  expect(snapshot.props.sheet).toBe(saved);
  expect(snapshot.props.calculation).toBe(saved.calculation);
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith("saved / exact");
  expect(mocks.connection).toHaveBeenCalledOnce();
  expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(mocks.tenant.mock.invocationCallOrder[0]);
  expect(mocks.tenant.mock.invocationCallOrder[0]).toBeLessThan(mocks.get.mock.invocationCallOrder[0]);
});
it("tenant admission failure blocks print reads", async () => {
  mocks.session.mockResolvedValue({ orgId: "org", userId: "u", access: ["COST_SHEETS"] });
  mocks.tenant.mockRejectedValueOnce(new Error("Tenant suspended"));
  await expect(PrintPage({ params: Promise.resolve({ id: "saved" }) })).rejects.toThrow("Tenant suspended");
  expect(mocks.get).not.toHaveBeenCalled();
});
it("live grant revocation is rechecked on each page entry", async () => {
  mocks.session.mockResolvedValueOnce({ orgId: "org", userId: "u", access: ["COST_SHEETS"] }).mockResolvedValueOnce({ orgId: "org", userId: "u", access: [] });
  await Page({ searchParams: Promise.resolve({}) });
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("/dashboard");
  expect(mocks.tenant).toHaveBeenCalledOnce();
});
it("print reads only the saved snapshot ID after live grant and tenant admission", async () => {
  mocks.session.mockResolvedValue({ orgId: "org", userId: "u", access: ["COST_SHEETS"] });
  mocks.get.mockResolvedValue(null);
  await expect(PrintPage({ params: Promise.resolve({ id: "saved" }) })).rejects.toThrow("404");
  expect(mocks.tenant).toHaveBeenCalledWith("org");
  expect(mocks.get).toHaveBeenCalledWith("saved");
});
