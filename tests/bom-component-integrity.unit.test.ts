/* eslint-disable @typescript-eslint/no-explicit-any -- DB-free persistence interpreter; real domain, schema, predicates and transaction adapter. */
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const s = vi.hoisted(() => ({
  orgId: "org-a", rows: {} as Record<string, Row[]>,
  events: [] as { operation: string; table: string; inTx: boolean }[],
  transactions: 0, inTx: false, fail: "",
}));

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => s.orgId }));
vi.mock("@/db/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { createTenantTransactionAdapter } = await import("@/db/transaction-context");
  const evaluate = (node: any, row: Row): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], row) === evaluate(chunks[3], row);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, row));
      if (text === "()") return evaluate(chunks[1], row);
      if (chunks.length === 1) return evaluate(chunks[0], row);
      throw new Error(`Unsupported predicate: ${text}`);
    }
    if (node?.table && node?.name) {
      const key = Object.keys(node.table).find((key) => node.table[key] === node)!;
      return row[key];
    }
    if (node && "value" in node) return node.value;
    return node;
  };
  const query = (table: any, operation: string) => {
    const name = getTableName(table);
    let predicate: any, limit = Infinity, values: Row | Row[];
    const builder: any = {
      where(p: any) { predicate = p; return builder; },
      limit(n: number) { limit = n; return builder; },
      values(v: Row | Row[]) { values = v; return builder; },
      set(v: Row) { values = v; return builder; },
      returning() { return builder; },
      then(resolve: any, reject: any) {
        try {
          s.events.push({ operation, table: name, inTx: s.inTx });
          if (s.fail === `${operation}:${name}`) throw new Error(`Injected ${s.fail} failure`);
          let result: Row[];
          if (operation === "insert") {
            result = (Array.isArray(values) ? values : [values]).map((value) => ({
              createdAt: new Date("2026-10-09T00:00:00Z"), ...value,
            }));
            s.rows[name].push(...result);
          } else {
            result = s.rows[name].filter((row) => !predicate || evaluate(predicate, row));
            if (operation === "update") result.forEach((row) => Object.assign(row, values));
          }
          resolve(structuredClone(result.slice(0, limit)));
        } catch (error) { reject(error); }
      },
    };
    return builder;
  };
  const transport = {
    select: () => ({ from: (table: any) => query(table, "select") }),
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

import { BomValidationError, COMPONENT_TYPES, createBom } from "@/lib/inventory/bom";
import { ITEM_CATEGORIES } from "@/lib/inventory/constants";
import { runInTenantTransaction } from "@/db/client";

const input = {
  productName: "Assembly", productSku: "FG-NEW", createdBy: "actor",
  lines: [{ componentSku: "OWN", componentName: "Owned material", qtyPerUnit: 0.125, uom: "kg" }],
};
const writes = () => s.events.filter((e) => e.operation !== "select");
const item = (sku: string, orgId = "org-a", category = "Raw Material") => ({
  sku, orgId, category, itemName: `${orgId} ${sku}`, uom: "kg", status: "Active",
  createdAt: new Date("2026-10-09T00:00:00Z"),
});

beforeEach(() => {
  s.orgId = "org-a"; s.events = []; s.transactions = 0; s.inTx = false; s.fail = "";
  s.rows = { bom: [], items: [item("OWN"), item("FOREIGN", "org-b")] };
});

it("rejects a missing item component before any write", async () => {
  const before = structuredClone(s.rows);
  await expect(createBom({ ...input, lines: [{ ...input.lines[0], componentSku: "MISSING" }] }))
    .rejects.toBeInstanceOf(BomValidationError);
  expect(writes()).toEqual([]);
  expect(s.rows).toEqual(before);
});

it("creates owned components and product item with all reads/writes in one tenant transaction", async () => {
  const result = await createBom(input);
  expect(result.lines[0]).toMatchObject({ componentSku: "OWN", qtyPerUnit: 0.125 });
  expect(s.rows.bom).toHaveLength(1);
  expect(s.rows.items.find((row) => row.sku === "FG-NEW")).toMatchObject({ orgId: "org-a", category: "FG" });
  expect(s.transactions).toBe(1);
  expect(s.events.every((e) => e.inTx)).toBe(true);
});

const oldBom = (overrides: Row = {}): Row => ({
  bomId: "BOM-old", orgId: "org-a", productName: "Assembly", productSku: "FG-NEW",
  version: "1", lineNo: "1", componentSku: "OWN", componentName: "Owned material",
  componentType: "Item", qtyPerUnit: "1", uom: "kg", status: "Active",
  createdAt: new Date("2026-10-08T00:00:00Z"), createdBy: "actor", ...overrides,
});

it("rolls back new lines and archival if product-item creation fails", async () => {
  s.rows.bom.push(oldBom());
  const before = structuredClone(s.rows);
  s.fail = "insert:items";
  await expect(createBom(input)).rejects.toThrow("Injected insert:items failure");
  expect(s.rows).toEqual(before);
  expect(writes().map((e) => `${e.operation}:${e.table}`)).toEqual(["insert:bom", "update:bom", "insert:items"]);
});

it.each([NaN, Infinity, -Infinity, 0, -1, "2"])("rejects non-finite/non-positive/non-numeric component quantity %s without writes", async (qty) => {
  const before = structuredClone(s.rows);
  await expect(createBom({ ...input, lines: [{ ...input.lines[0], qtyPerUnit: qty as number }] }))
    .rejects.toBeInstanceOf(BomValidationError);
  expect(writes()).toEqual([]);
  expect(s.rows).toEqual(before);
});

// Characterization/regression gates for the existing supported vocabulary: neither
// the UI nor production resolves Product lines to BOM_ID or branches on type.
it.each(COMPONENT_TYPES.flatMap((componentType) =>
  ITEM_CATEGORIES.map((category) => ({ componentType, category })),
))("accepts tenant-owned $category inventory as $componentType without requiring a component BOM", async ({ componentType, category }) => {
  s.rows.items = [item("OWN", "org-a", category)];
  const result = await createBom({ ...input, lines: [{ ...input.lines[0], componentType }] });
  expect(result.lines).toEqual([{ ...input.lines[0], componentType, lineNo: 1 }]);
  expect(s.rows.bom[0]).toMatchObject({ componentType, componentSku: "OWN", orgId: "org-a" });
});

it.each(COMPONENT_TYPES.flatMap((componentType) =>
  ["MISSING", "FOREIGN"].map((componentSku) => ({ componentType, componentSku })),
))("rejects $componentType component $componentSku after a valid line without any write", async ({ componentType, componentSku }) => {
  s.rows.bom.push(oldBom());
  // A BOM-only product identity cannot substitute for its required inventory SKU.
  s.rows.bom.push(oldBom({ bomId: "BOM-other", productName: "Subassembly", productSku: componentSku }));
  const before = structuredClone(s.rows);
  await expect(createBom({ ...input, lines: [input.lines[0], { ...input.lines[0], componentType, componentSku }] }))
    .rejects.toThrow(`Component SKU "${componentSku}" Items master me nahi mila.`);
  expect(writes()).toEqual([]);
  expect(s.rows).toEqual(before);
  expect(s.events.every((e) => e.inTx)).toBe(true);
});

it("uses current-tenant component and product identity when SKU strings are shared", async () => {
  // Foreign rows deliberately come first to catch a missing tenant predicate.
  s.rows.items = [item("OWN", "org-b"), item("FG-NEW", "org-b"), item("OWN")];
  s.rows.bom.push(oldBom({ bomId: "BOM-foreign", orgId: "org-b", productName: "Other product" }));
  const result = await createBom(input);
  expect(result.version).toBe(1);
  expect(s.rows.bom.filter((row) => row.orgId === "org-a")).toHaveLength(1);
  expect(s.rows.bom[0].status).toBe("Active");
  expect(s.rows.items.filter((row) => row.sku === "FG-NEW").map((row) => row.orgId)).toEqual(["org-b", "org-a"]);
});

it("admits the same shared component SKU separately for each tenant", async () => {
  s.rows.items = [item("OWN", "org-b"), item("OWN")];
  await createBom(input);
  s.orgId = "org-b";
  await createBom(input);
  expect(s.rows.bom.map((row) => row.orgId)).toEqual(["org-a", "org-b"]);
  expect(s.rows.items.filter((row) => row.sku === "FG-NEW").map((row) => row.orgId)).toEqual(["org-a", "org-b"]);
});

it("supersedes only the tenant's prior BOM and preserves an existing product item", async () => {
  s.rows.bom.push(oldBom(), oldBom({ bomId: "BOM-foreign", orgId: "org-b" }));
  s.rows.items.push(item("SECOND", "org-a", "Semi-FG"), item("FG-NEW", "org-a", "Semi-FG"));
  const beforeItems = structuredClone(s.rows.items);
  const result = await createBom({ ...input, productSku: undefined, lines: [
    input.lines[0], { ...input.lines[0], componentSku: "SECOND", componentType: "Product" },
  ] });
  expect(result).toMatchObject({ version: 2, productSku: "FG-NEW" });
  expect(result.lines.map((line) => line.lineNo)).toEqual([1, 2]);
  expect(s.rows.bom.map((row) => row.status)).toEqual(["Archived", "Active", "Active", "Active"]);
  expect(s.rows.items).toEqual(beforeItems);
  expect(s.events.every((e) => e.inTx)).toBe(true);
});

it.each(["insert:bom", "update:bom"])("preserves prior committed rows on %s failure", async (failure) => {
  s.rows.bom.push(oldBom());
  const before = structuredClone(s.rows);
  s.fail = failure;
  await expect(createBom(input)).rejects.toThrow(`Injected ${failure} failure`);
  expect(s.rows).toEqual(before);
  expect(s.events.every((e) => e.inTx)).toBe(true);
});

it("joins an enclosing tenant transaction and leaves no partial state when the owner fails", async () => {
  s.rows.bom.push(oldBom());
  const before = structuredClone(s.rows);
  await expect(runInTenantTransaction("org-a", async () => {
    await createBom(input);
    expect(s.rows.bom).toHaveLength(2);
    expect(s.rows.items.some((row) => row.sku === "FG-NEW")).toBe(true);
    throw new Error("owner failed");
  })).rejects.toThrow("owner failed");
  expect(s.transactions).toBe(1);
  expect(s.events.every((e) => e.inTx)).toBe(true);
  expect(s.rows).toEqual(before);
});

it("preserves duplicate-component rejection without writes", async () => {
  await expect(createBom({ ...input, lines: [input.lines[0], input.lines[0]] }))
    .rejects.toBeInstanceOf(BomValidationError);
  expect(writes()).toEqual([]);
});
