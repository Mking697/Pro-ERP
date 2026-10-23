import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db/client", async () => { const { drizzle } = await import("drizzle-orm/pg-proxy"); return { db: drizzle(async (sql, params) => m.query(sql, params)) }; });
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-cost" }));
vi.mock("@/lib/auth/guard", () => ({ requireModule: vi.fn() }));
vi.mock("@/lib/mutations", () => ({ runIdempotentTenantMutation: vi.fn() }));
import { previewCostSheet } from "@/lib/costing/service";
import { input } from "./costing-fixtures";

type Row = Record<string, Record<string, unknown>>;
const indent = { id: "IND", org_id: "ORG-cost", sku: "RM", uom: "Kg", po_id: "PO", status: "Received", received_qty: "10", received_at: "2026-10-23T06:00:00Z" };
const line = { id: "POL", org_id: "ORG-cost", indent_id: "IND", sku: "RM", po_id: "PO", new_price: "20", old_price: "5" };
const receipt = (id: string, timestamp: string) => ({ id, org_id: "ORG-cost", sku: "RM", uom: "Kg", reference_id: "IND", source: "Indent_Receipt", direction: "In", quantity: "5", timestamp });
let events: Row[];
beforeEach(() => {
  vi.clearAllMocks();
  events = [receipt("TX1", "2026-10-21T06:00:00Z"), receipt("TX2", "2026-10-23T06:00:00Z")].map(stock_ledger => ({ indents: indent, purchase_order_lines: line, purchase_orders: { id: "PO", org_id: "ORG-cost", status: "Completed" }, stock_ledger }));
  m.query.mockImplementation(async (sql: string) => {
    let rows: Row[];
    if (sql.includes('from "indents"')) rows = events;
    else if (sql.includes('from "bom"')) rows = [{ bom: { bom_id: "B", version: "1", component_sku: "RM", component_name: "Steel", qty_per_unit: "1", uom: "Kg" } }];
    else if (sql.includes('from "standard_cost_rates"')) rows = [{ standard_cost_rates: { id: "STD", sku: "RM", uom: "Kg", rate: "10", effective_date: "2026-10-01", approved_at: "2026-10-01T00:00:00Z", approved_by: "U", reason: "Approved" } }];
    else rows = [{ items: { sku: sql.includes("limit") ? "FG" : "RM", item_name: "Item", uom: "Kg" } }];
    const selection = sql.slice(7, sql.indexOf(" from "));
    const table = /from "([^"]+)"/.exec(sql)![1];
    return { rows: rows.map(row => selection.split(", ").map(column => {
      const parts = [...column.matchAll(/"([^"]+)"/g)].map(match => match[1]);
      return parts.length > 1 ? row[parts[0]]?.[parts[1]] ?? null : row[table]?.[parts[0]] ?? null;
    })) };
  });
});
it("historical purchase selection survives a later partial receipt and transports individual events with exact tenant/indent/line links", async () => {
  const result = await previewCostSheet({ ...input, asOfDate: "2026-10-22" });
  expect(result.materials[0].rate).toBe("20");
  expect(result.materials[0].source).toMatchObject({ kind: "Purchase", id: "POL", date: "2026-10-21T06:00:00.000Z" });
  expect(result.materials[0].source.description).toContain("TX1");
  const [sql, params] = m.query.mock.calls.find(([sql]) => sql.includes('from "indents"'))!;
  expect(sql).toContain('"stock_ledger"."timestamp"');
  expect(sql).toContain('"stock_ledger"."quantity"');
  for (const column of ["reference_id", "sku", "uom", "org_id", "source", "direction"]) expect(sql).toContain(`"stock_ledger"."${column}" =`);
  expect(sql).toContain('"purchase_order_lines"."indent_id" = "indents"."id"');
  expect(sql).toContain('"purchase_order_lines"."po_id" = "indents"."po_id"');
  expect(sql).toContain('"purchase_order_lines"."sku" = "indents"."sku"');
  expect(params).toEqual(expect.arrayContaining(["ORG-cost", "Indent_Receipt", "In"]));
  expect(sql).not.toMatch(/limit/i);
});
it("legacy cumulative receipts without a trustworthy individual event disclose fallback rather than inventing a purchase date", async () => {
  events = [{ ...events[0], stock_ledger: {} }];
  const result = await previewCostSheet(input);
  expect(result.materials[0].source.kind).toBe("Standard");
  expect(result.materials[0].rate).toBe("10");
  expect(result.warnings.join(" ")).toContain("receipt event history is missing or ambiguous");
});
it("an individual receipt matching multiple PO lines is not a proven purchase rate", async () => {
  events = [events[0], { ...events[0], purchase_order_lines: { ...line, id: "POL-corrupt", new_price: "99" } }];
  const result = await previewCostSheet(input);
  expect(result.materials[0].source.kind).toBe("Standard");
  expect(result.warnings.join(" ")).toContain("ambiguous");
});
it.each(["0", "-1", "NaN", "Infinity"])("rejects nonpositive or invalid individual receipt quantity %s", async quantity => {
  events = [{ ...events[0], stock_ledger: { ...events[0].stock_ledger, quantity } }];
  expect((await previewCostSheet(input)).materials[0].source.kind).toBe("Standard");
});
