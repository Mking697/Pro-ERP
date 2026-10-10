/* eslint-disable @typescript-eslint/no-explicit-any -- DB-free persistence interpreter for real Drizzle predicates and repo helpers. */
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const s = vi.hoisted(() => ({
  orgId: "org-a", rows: {} as Record<string, Row[]>,
  events: [] as { operation: string; table: string; inTx: boolean }[],
  transactions: 0, inTx: false,
}));

// Only transport/persistence and tenant resolution are replaced. Domain, schema,
// Drizzle SQL predicates, CRUD helpers and transaction-context adapter are real.
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => s.orgId }));
vi.mock("@/db/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { createTenantTransactionAdapter } = await import("@/db/transaction-context");
  const evaluate = (node: any, context: Record<string, Row | null>): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], context) === evaluate(chunks[3], context);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, context));
      if (text === "()") return evaluate(chunks[1], context);
      if (chunks.length === 1) return evaluate(chunks[0], context);
    }
    if (node?.table && node?.name) {
      const key = Object.keys(node.table).find((key) => node.table[key] === node)!;
      return context[getTableName(node.table)]?.[key];
    }
    if (node && "value" in node) return node.value;
    return node;
  };
  const project = (selection: Row, context: Record<string, Row | null>) =>
    Object.fromEntries(Object.entries(selection).map(([key, value]) => [key,
      value?.table ? evaluate(value, context) : context[getTableName(value)]]));
  const query = (table: any, operation: string, selection?: Row) => {
    const name = getTableName(table);
    let predicate: any, join: any, joinPredicate: any, limit = Infinity, values: Row;
    const builder: any = {
      where(p: any) { predicate = p; return builder; },
      leftJoin(t: any, p: any) { join = t; joinPredicate = p; return builder; },
      limit(n: number) { limit = n; return builder; },
      values(v: Row) { values = v; return builder; },
      set(v: Row) { values = v; return builder; },
      returning() { return builder; },
      then(resolve: any, reject: any) {
        try {
          s.events.push({ operation, table: name, inTx: s.inTx });
          let result: Row[] = [];
          if (operation === "insert") {
            const row = { createdAt: new Date("2026-10-09T00:00:00Z"), ...values };
            s.rows[name].push(row); result = [row];
          } else {
            for (const row of s.rows[name]) {
              const context = { [name]: row };
              if (operation === "update") {
                if (!predicate || evaluate(predicate, context)) { Object.assign(row, values); result.push(row); }
                continue;
              }
              const matches = join ? s.rows[getTableName(join)].filter((r) =>
                evaluate(joinPredicate, { ...context, [getTableName(join)]: r })) : [null];
              for (const joined of matches.length ? matches : [null]) {
                const joinedContext = join ? { ...context, [getTableName(join)]: joined } : context;
                if (!predicate || evaluate(predicate, joinedContext)) {
                  result.push(selection ? project(selection, joinedContext) : row);
                }
              }
            }
          }
          resolve(structuredClone(result.slice(0, limit)));
        } catch (error) { reject(error); }
      },
    };
    return builder;
  };
  const transport = {
    select: (selection?: Row) => ({ from: (table: any) => query(table, "select", selection) }),
    insert: (table: any) => query(table, "insert"),
    update: (table: any) => query(table, "update"),
  };
  return createTenantTransactionAdapter({
    db: transport,
    async transact(work) {
      s.transactions++; s.inTx = true;
      const snapshot = structuredClone(s.rows);
      try { return await work(transport); }
      catch (error) { s.rows = snapshot; throw error; }
      finally { s.inTx = false; }
    },
    admit: async () => {},
    savepoint: async (tx, work) => work(tx),
  });
});

import { listVendorItems, upsertVendorItem } from "@/lib/parties/vendorItems";
import { runInTenantTransaction } from "@/db/client";

function link(overrides: Row = {}): Row {
  return { id: "VIT-existing", orgId: "org-a", vendorId: "VEN-owned", sku: "SAME",
    leadTimeDays: 3, unitPrice: "12.5", createdAt: new Date("2026-10-09T00:00:00Z"), createdBy: "actor", ...overrides };
}
const input = { vendorId: "VEN-owned", sku: "SAME", createdBy: "actor", leadTimeDays: 3, unitPrice: 12.5 };
const writes = () => s.events.filter((e) => e.operation !== "select");

it.each(["VEN-foreign", "VEN-missing"])("rejects unowned vendor %s without any write", async (vendorId) => {
  await expect(upsertVendorItem({ ...input, vendorId })).rejects.toThrow("Vendor nahi mila.");
  expect(writes()).toEqual([]);
  expect(s.rows.vendor_items).toEqual([]);
});

it.each(["FOREIGN", "MISSING"])("rejects unowned item %s without any write", async (sku) => {
  await expect(upsertVendorItem({ ...input, sku })).rejects.toThrow("Item nahi mila.");
  expect(writes()).toEqual([]);
  expect(s.rows.vendor_items).toEqual([]);
});

it.each([NaN, Infinity, -Infinity, -1, 1.5, 2147483648, "3"])(
  "rejects invalid lead-time operand %s without any write", async (leadTimeDays) => {
    await expect(upsertVendorItem({ ...input, leadTimeDays: leadTimeDays as number })).rejects.toThrow("Lead time");
    expect(writes()).toEqual([]);
  },
);

it.each([NaN, Infinity, -Infinity, -0.01, "12.5"])(
  "rejects invalid unit-price operand %s without any write", async (unitPrice) => {
    await expect(upsertVendorItem({ ...input, unitPrice: unitPrice as number })).rejects.toThrow("Unit price");
    expect(writes()).toEqual([]);
  },
);

it("admits owned references and writes create/update inside the tenant transaction", async () => {
  const created = await upsertVendorItem(input);
  const updated = await upsertVendorItem({ ...input, leadTimeDays: 0, unitPrice: 0 });
  expect(updated.Vendor_Item_ID).toBe(created.Vendor_Item_ID);
  expect(updated).toMatchObject({ Lead_Time_Days: "0", Unit_Price: "0" });
  expect(s.rows.vendor_items).toHaveLength(1);
  expect(writes().map((e) => e.operation)).toEqual(["insert", "update"]);
  expect(s.events.every((e) => e.inTx)).toBe(true);
  expect(s.transactions).toBe(2);
});

it.each([
  { vendorId: "VEN-foreign", sku: "SAME", error: "Vendor nahi mila." },
  { vendorId: "VEN-missing", sku: "SAME", error: "Vendor nahi mila." },
  { vendorId: "VEN-owned", sku: "FOREIGN", error: "Item nahi mila." },
  { vendorId: "VEN-owned", sku: "MISSING", error: "Item nahi mila." },
])("rejects an existing link with unowned references $vendorId/$sku", async ({ vendorId, sku, error }) => {
  const existing = link({ vendorId, sku });
  s.rows.vendor_items.push(existing);
  await expect(upsertVendorItem({ ...input, vendorId, sku })).rejects.toThrow(error);
  expect(writes()).toEqual([]);
  expect(s.rows.vendor_items).toEqual([existing]);
});

it.each([null, undefined, 0])("preserves nullable/zero operands %s on an owned link", async (value) => {
  const record = await upsertVendorItem({ ...input, leadTimeDays: value, unitPrice: value });
  expect(record).toMatchObject({ Lead_Time_Days: value === 0 ? "0" : "", Unit_Price: value === 0 ? "0" : "" });
  expect(s.rows.vendor_items[0]).toMatchObject({ leadTimeDays: value ?? null, unitPrice: value === 0 ? "0" : null });
});

it("joins a same-org transaction and rolls back the link when its owner fails", async () => {
  await expect(runInTenantTransaction("org-a", async () => {
    await upsertVendorItem(input);
    expect(s.rows.vendor_items).toHaveLength(1);
    throw new Error("owner failed");
  })).rejects.toThrow("owner failed");
  expect(s.transactions).toBe(1);
  expect(s.events.every((e) => e.inTx)).toBe(true);
  expect(s.rows.vendor_items).toEqual([]);
});

it("rejects an invalid operand before updating an existing owned link", async () => {
  const existing = link();
  s.rows.vendor_items.push(existing);
  await expect(upsertVendorItem({ ...input, unitPrice: NaN })).rejects.toThrow("Unit price");
  expect(writes()).toEqual([]);
  expect(s.rows.vendor_items).toEqual([existing]);
});

it("accepts database-max lead time and a fractional non-negative price", async () => {
  const record = await upsertVendorItem({ ...input, leadTimeDays: 2147483647, unitPrice: 0.125 });
  expect(record).toMatchObject({ Lead_Time_Days: "2147483647", Unit_Price: "0.125" });
});

beforeEach(() => {
  s.orgId = "org-a"; s.events = []; s.transactions = 0; s.inTx = false;
  s.rows = {
    vendors: [{ id: "VEN-owned", orgId: "org-a" }, { id: "VEN-foreign", orgId: "org-b" }],
    items: [{ orgId: "org-a", sku: "SAME", itemName: "Own item", uom: "kg" },
      { orgId: "org-b", sku: "SAME", itemName: "Foreign item", uom: "litre" },
      { orgId: "org-b", sku: "FOREIGN", itemName: "Other", uom: "box" }],
    vendor_items: [],
  };
});

it("lists only the tenant's item name and UOM when two tenants share a SKU", async () => {
  s.rows.vendor_items.push(link(), link({ id: "VIT-foreign", orgId: "org-b", vendorId: "VEN-foreign" }));
  const own = await listVendorItems("VEN-owned");
  expect(own).toHaveLength(1);
  expect(own[0]).toMatchObject({ Item_Name: "Own item", UOM: "kg" });
  s.orgId = "org-b";
  const foreign = await listVendorItems("VEN-foreign");
  expect(foreign).toHaveLength(1);
  expect(foreign[0]).toMatchObject({ Item_Name: "Foreign item", UOM: "litre" });
});
