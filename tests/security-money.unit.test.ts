import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import * as schema from "@/db/schema";

const h = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, writes: 0, seq: 0 }));
function tableRows(table: unknown) { return h.rows[getTableName(table as typeof schema.vendors)] ??= []; }
function query(work: () => unknown) {
  const chain = { where: () => chain, orderBy: () => chain, limit: () => chain, returning: () => chain,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(work).then(resolve, reject) };
  return chain;
}
vi.mock("@/db/client", () => ({
  runInTenantTransaction: async (_org: string, work: () => Promise<unknown>) => {
    const snapshot = structuredClone(h.rows);
    try { return await work(); } catch (error) { h.rows = snapshot; throw error; }
  },
  afterTenantCommit: async () => {},
  db: {
    select: () => ({ from: (table: unknown) => query(() => tableRows(table)) }),
    insert: (table: unknown) => ({ values: (values: Record<string, unknown> | Record<string, unknown>[]) => query(() => {
      h.writes++; const rows = Array.isArray(values) ? values : [values]; tableRows(table).push(...rows); return rows;
    }) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => query(() => { h.writes++; tableRows(table).forEach((row) => Object.assign(row, values)); return tableRows(table); }) }),
    delete: (table: unknown) => query(() => { h.writes++; h.rows[getTableName(table as typeof schema.vendors)] = []; }),
    batch: async (queries: PromiseLike<unknown>[]) => Promise.all(queries),
  },
}));
vi.mock("@/db/repo", () => ({
  findById: async (table: unknown, _org: string, id: string) => tableRows(table).find((row) => row.id === id) ?? null,
  insertRecord: async (table: unknown, value: Record<string, unknown>) => { h.writes++; const row = { createdAt: new Date(), ...value }; tableRows(table).push(row); return row; },
  updateById: async (table: unknown, _org: string, id: string, value: Record<string, unknown>) => { h.writes++; const row = tableRows(table).find((row) => row.id === id); Object.assign(row!, value); return row; },
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG" }));
vi.mock("@/lib/id", () => ({ generateId: () => `ID-${++h.seq}` }));
vi.mock("@/lib/mutations", () => ({ runIdempotentTenantMutation: async (_org: string, _options: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/fms/calendar", () => ({ computeDefaultTatDeadline: async () => Date.now(), computeTatDeadline: async () => Date.now() }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => null }));
vi.mock("@/lib/storage", () => ({ uploadAttachment: vi.fn() }));
vi.mock("@/lib/parties/customers", () => ({ createCustomer: vi.fn() }));
vi.mock("@/lib/leads/leads", () => ({ logLeadActivity: vi.fn(), markOrderConfirmed: vi.fn(), markQuotationSent: vi.fn() }));
vi.mock("@/lib/leads/quotationSetup", () => ({ getQuotationSetup: vi.fn() }));
vi.mock("@/lib/parties/vendorItems", () => ({ getVendorItemLink: async () => ({ unitPrice: "10", leadTimeDays: 1 }), listVendorsForSkus: vi.fn() }));
vi.mock("@/lib/purchase/settings", () => ({ getPurchaseSetup: async () => ({ gstPercentDefault: 18, defaultTerms: "", defaultNote: "" }) }));
vi.mock("@/lib/inventory/indents", () => ({ receiveIndentForPurchaseOrder: vi.fn() }));

import { createGeneralPurchaseOrder, GeneralPurchaseOrderError } from "@/lib/purchase/generalOrders";
import { createPurchaseOrder, PurchaseOrderError } from "@/lib/purchase/orders";
import { saveQuotationItems, QuotationError } from "@/lib/leads/quotations";
import { recordExchangeRate, CurrencyError } from "@/lib/currency/currency";

beforeEach(() => {
  h.rows = {}; h.writes = 0; h.seq = 0;
  tableRows(schema.vendors).push({ id: "V", orgId: "ORG", vendorName: "Vendor" });
  tableRows(schema.indents).push({ id: "I", orgId: "ORG", status: "Approved", finalQty: "2", sku: "SKU", itemName: "Item", uom: "PCS", poId: "" });
  tableRows(schema.quotations).push({ id: "Q", orgId: "ORG", status: "Draft", createdAt: new Date() });
});
const invalid = [-1, Infinity, NaN, 1e20];
it.each(["qty", "rate", "gstPercent"] as const)("general PO write rejects hostile %s", async (field) => {
  for (const value of invalid) {
    const input = { vendorId: "V", attachmentUrl: "po.pdf", issuedBy: "actor", expectedDeliveryDays: 1, lines: [{ particular: "Widget", qty: 2, rate: 10 }], gstPercent: 18 };
    if (field === "gstPercent") input.gstPercent = value; else input.lines[0][field] = value;
    await expect(createGeneralPurchaseOrder(input), `${field}=${value}`).rejects.toThrow(GeneralPurchaseOrderError);
    expect(h.writes).toBe(0);
  }
});
it.each(["qty", "rate", "gstPercent"] as const)("indent PO write rejects hostile %s", async (field) => {
  for (const value of invalid) {
    const input = { vendorId: "V", attachmentUrl: "po.pdf", issuedBy: "actor", lines: [{ indentId: "I", newPrice: 10 }], gstPercent: 18 };
    if (field === "qty") tableRows(schema.indents)[0].finalQty = String(value);
    else if (field === "rate") input.lines[0].newPrice = value;
    else input.gstPercent = value;
    await expect(createPurchaseOrder(input), `${field}=${value}`).rejects.toThrow(PurchaseOrderError);
    expect(h.writes).toBe(0);
  }
});
it.each(["qty", "rate", "gstPercent", "freightAmount"] as const)("quotation write rejects hostile %s rather than clamping", async (field) => {
  for (const value of invalid) {
    const rows = [{ particular: "Widget", qty: 2, rate: 10 }];
    const money = { freightAmount: 0, gstPercent: 18 };
    if (field === "qty" || field === "rate") rows[0][field] = value; else money[field] = value;
    await expect(saveQuotationItems("Q", rows, money), `${field}=${value}`).rejects.toThrow(QuotationError);
    expect(h.writes).toBe(0);
  }
});
it.each(invalid)("exchange-rate write rejects hostile rate %s before persistence", async (rate) => {
  await expect(recordExchangeRate("USD", rate, "actor")).rejects.toThrow(CurrencyError);
  expect(h.writes).toBe(0);
});
it("general PO rejects in-range operands with an absurd product", async () => {
  await expect(createGeneralPurchaseOrder({ vendorId: "V", attachmentUrl: "po.pdf", issuedBy: "actor", expectedDeliveryDays: 1, lines: [{ particular: "Widget", qty: 1e9, rate: 1e9 }] })).rejects.toThrow(GeneralPurchaseOrderError);
  expect(h.writes).toBe(0);
});
it("valid general PO, indent PO, quotation and exchange rate still persist", async () => {
  await createGeneralPurchaseOrder({ vendorId: "V", attachmentUrl: "po.pdf", issuedBy: "actor", expectedDeliveryDays: 1, lines: [{ particular: "Widget", qty: 2, rate: 10 }], gstPercent: 18 });
  await createPurchaseOrder({ vendorId: "V", attachmentUrl: "po.pdf", issuedBy: "actor", lines: [{ indentId: "I", newPrice: 10 }], gstPercent: 18 });
  await saveQuotationItems("Q", [{ particular: "Widget", qty: 2, rate: 10 }], { freightAmount: 0, gstPercent: 18 });
  await recordExchangeRate("USD", 83.5, "actor");
  expect(tableRows(schema.generalPurchaseOrderLines)[0].amount).toBe("20");
  expect(tableRows(schema.quotationItems)[0].amount).toBe("20");
  expect(tableRows(schema.exchangeRates)[0].rateToInr).toBe("83.5");
});
