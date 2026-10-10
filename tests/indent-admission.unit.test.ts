/* eslint-disable @typescript-eslint/no-explicit-any -- DB-free persistence interpreter */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Real domain, item finder, repo, schema, predicates, calendar and transaction adapter.
// Only database transport and request identity/auth boundaries are simulated.
const h = vi.hoisted(() => ({
  state: { org: "a", rows: {} as Record<string, Record<string, any>[]>, active: false, events: [] as string[], reads: [] as string[], fault: "", committedWarning: false },
  insert: vi.fn(), tx: vi.fn(),
}));
vi.mock("@/db/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { createTenantTransactionAdapter } = await import("@/db/transaction-context");
  const evaluate = (node: any, row: Record<string, any>): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], row) === evaluate(chunks[3], row);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, row));
      if (text === "()") return evaluate(chunks[1], row);
      if (chunks.length === 1) return evaluate(chunks[0], row);
      throw new Error(`Unsupported predicate: ${text}`);
    }
    if (node?.table && node?.name) return row[Object.keys(node.table).find((key) => node.table[key] === node)!];
    if (node && "value" in node) return node.value;
    return node;
  };
  const query = (table: any, operation: string) => {
    const rawName = getTableName(table);
    const name = rawName === "production_plans" ? "productionPlans" : rawName;
    let predicate: any, limit = Infinity, values: Record<string, any>;
    const builder: any = {
      where(p: any) { predicate = p; return builder; }, limit(n: number) { limit = n; return builder; },
      values(v: Record<string, any>) { values = v; return builder; }, returning() { return builder; },
      then(resolve: any, reject: any) {
        try {
          let result: Record<string, any>[];
          if (operation === "insert") {
            h.state.events.push(`write:${name}:${h.state.active}`);
            result = [{ timestamp: new Date(), approvedAt: null, receivedAt: null, ...values }];
            (h.state.rows[name] ??= []).push(...result);
            if (h.state.fault === "insert") throw new Error("private infrastructure failure");
          } else {
            h.state.reads.push(`${name}:${h.state.active}`);
            if (["items", "productionPlans"].includes(name)) h.state.events.push(`read:${name}:${h.state.active}`);
            if (name === "settings" && h.state.fault === "settings-once") {
              h.state.fault = "";
              throw new Error("private infrastructure failure");
            }
            result = (h.state.rows[name] ?? []).filter((row) => !predicate || evaluate(predicate, row));
          }
          resolve(structuredClone(result.slice(0, limit)));
        } catch (error) { reject(error); }
      },
    };
    return builder;
  };
  h.insert.mockImplementation((table: any) => query(table, "insert"));
  const transport = { select: () => ({ from: (table: any) => query(table, "select") }), insert: h.insert };
  const adapter = createTenantTransactionAdapter({
    db: transport,
    async transact(work) {
      const snapshot = structuredClone(h.state.rows);
      h.state.active = true;
      let result;
      try { result = await work(transport); }
      catch (error) { h.state.rows = snapshot; h.state.events.push("rollback"); throw error; }
      finally { h.state.active = false; }
      h.state.events.push("commit");
      // Inject persisted state followed by lost COMMIT acknowledgement, no marker.
      if (h.state.fault === "commit-ack") throw new Error("private COMMIT acknowledgement lost");
      if (h.state.committedWarning) throw Object.assign(new Error("cleanup failure"), { committed: true, result });
      return result;
    },
    admit: async (_tx, org) => { h.state.events.push(`admit:${org}`); },
    savepoint: async (tx, work) => work(tx),
  });
  h.tx.mockImplementation(adapter.runInTenantTransaction);
  return { ...adapter, runInTenantTransaction: h.tx };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => h.state.org }));
vi.mock("@/lib/auth/guard", () => ({ requireModule: async () => ({ ok: true, session: { userId: "trusted-actor" } }) }));

import { createIndent, type CreateIndentInput } from "../src/lib/inventory/indents";

const input: CreateIndentInput = { sku: "shared", itemName: "spoof", uom: "spoof", suggestedQty: 0, finalQty: 1.25, reason: "Reorder", requestedBy: "actor" };
function item(orgId: string, itemName = "Owned material", uom = "kg") {
  return { orgId, sku: "shared", itemName, uom, createdAt: new Date(), leadTimeDays: null };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.state.org = "a"; h.state.active = false; h.state.events = []; h.state.reads = []; h.state.fault = ""; h.state.committedWarning = false;
  h.state.rows = { items: [item("a")], indents: [], productionPlans: [], settings: [
    { orgId: "a", key: "PURCHASE_STEP1_TAT_VALUE", value: "2" },
    { orgId: "a", key: "PURCHASE_STEP1_TAT_UNIT", value: "Hours" },
  ] };
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T03:30:00.000Z"));
});
afterEach(() => vi.restoreAllMocks());

// Compatibility/rollback gates for the already-green transaction and metadata slice.
it.each([undefined, ""])("preserves an optional empty linked plan (%s)", async (linkedPlanId) => {
  const saved = await createIndent({ ...input, linkedPlanId, reason: "Production_Shortage" });
  expect(saved.Linked_Plan_ID).toBe("");
  expect(h.state.events).not.toContain("read:productionPlans:true");
});

it("accepts an owned linked plan and fractional suggestion without rewriting quantities", async () => {
  h.state.rows.productionPlans = [{ id: "plan", orgId: "b" }, { id: "plan", orgId: "a", status: "Completed" }];
  const saved = await createIndent({ ...input, linkedPlanId: "plan", suggestedQty: 0.375 });
  expect(saved).toMatchObject({ Linked_Plan_ID: "plan", Suggested_Qty: "0.375", Final_Qty: "1.25" });
  expect(h.state.events).toEqual(["admit:a", "read:items:true", "read:productionPlans:true", "write:indents:true", "commit"]);
});

it.each(["", "doer"])("preserves the purchase TAT branch for doer '%s'", async (step1Doer) => {
  h.state.rows.settings.push({ orgId: "a", key: "PURCHASE_STEP1_DOER", value: step1Doer });
  const saved = await createIndent(input);
  expect(saved.Step1_Due_At).toBe("2026-10-09T05:30:00.000Z");
  expect(h.state.reads.every((read) => read.endsWith(":true"))).toBe(true);
  expect(h.state.reads.includes("users:true")).toBe(Boolean(step1Doer));
});

it("joins the caller's tenant transaction and rolls creation back on required outer-state failure", async () => {
  await expect(h.tx("a", async () => {
    await createIndent(input);
    expect(h.state.rows.indents).toHaveLength(1);
    throw new Error("required state failed");
  })).rejects.toThrow("required state failed");
  expect(h.state.rows.indents).toEqual([]);
  expect(h.state.events).toEqual(["admit:a", "read:items:true", "write:indents:true", "rollback"]);
});

it("rolls back a persisted creation when its required insert acknowledgement fails", async () => {
  h.state.fault = "insert";
  await expect(createIndent(input)).rejects.toThrow("private infrastructure failure");
  expect(h.state.rows.indents).toEqual([]);
  expect(h.state.events).toEqual(["admit:a", "read:items:true", "write:indents:true", "rollback"]);
});

async function post(inputs: CreateIndentInput[] = [input]) {
  const { POST } = await import("../src/app/api/inventory/indents/route");
  return POST(new Request("https://example.invalid/api/inventory/indents", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indents: inputs }),
  }));
}

it("keeps successful batch siblings when an item has a typed admission failure", async () => {
  const response = await post([{ ...input, sku: "missing" }, input]);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ created: 1, indents: [{ SKU: "shared", Requested_By: "trusted-actor" }], failed: [{ sku: "missing", error: "Item nahi mila." }] });
  expect(h.state.rows.indents).toHaveLength(1);
});

it("retains committed siblings when another batch item has an infrastructure failure, marked unknown not failed", async () => {
  h.state.fault = "settings-once";
  const response = await post([input, input]);
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toMatchObject({ committed: true, created: 1, indents: [{ Item_Name: "Owned material" }], failed: [], unknown: [{ sku: "shared" }] });
  expect(h.state.rows.indents).toHaveLength(1);
  expect(h.insert).toHaveBeenCalledTimes(1);
});

it("marks a lost COMMIT acknowledgement as unknown, never a definite failed or a fabricated success", async () => {
  h.state.fault = "commit-ack";
  const response = await post();
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toMatchObject({ created: 0, indents: [], failed: [], unknown: [{ sku: "shared", error: expect.any(String) }] });
  expect(JSON.stringify(body)).not.toContain("private COMMIT");
  // The row was genuinely written before the ack was lost — never pretend otherwise.
  expect(h.state.rows.indents).toHaveLength(1);
});

it("keeps a saved sibling distinct from an unknown sibling in the same batch", async () => {
  h.state.fault = "commit-ack";
  const response = await post([input, { ...input, sku: "missing" }]);
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body).toMatchObject({
    created: 0, indents: [],
    failed: [{ sku: "missing", error: "Item nahi mila." }],
    unknown: [{ sku: "shared" }],
  });
});

it("reports confirmed committed creation as success without retry or rollback", async () => {
  h.state.committedWarning = true;
  const response = await post();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ created: 1, committed: true, failed: [], indents: [{ Item_Name: "Owned material", Requested_By: "trusted-actor" }], warnings: [{ sku: "shared", warning: "Indent ban gaya; transaction cleanup failed." }] });
  expect(h.state.rows.indents).toHaveLength(1);
  expect(h.insert).toHaveBeenCalledTimes(1);
  expect(h.tx).toHaveBeenCalledTimes(1);
  expect(h.state.events).not.toContain("rollback");
});

it("returns a generic 500 with the failure marked unknown, never a definite failed, for infrastructure failure with rolled-back state", async () => {
  h.state.fault = "insert";
  const response = await post();
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body).toMatchObject({ created: 0, indents: [], failed: [], unknown: [{ sku: "shared" }] });
  expect(JSON.stringify(body)).not.toContain("private infrastructure");
  expect(h.state.rows.indents).toEqual([]);
  expect(h.state.events).toContain("rollback");
});

it.each(["item", "plan"])("maps a missing tenant-owned %s to a typed 404 admission failure", async (kind) => {
  if (kind === "item") h.state.rows.items = [];
  const response = await post([{ ...input, ...(kind === "plan" ? { linkedPlanId: "missing-plan" } : {}) }]);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ created: 0, indents: [], failed: [{ sku: "shared" }] });
  expect(h.insert).not.toHaveBeenCalled();
});

it.each(["missing", "foreign-only"])("rejects a %s linked production plan without writes", async (kind) => {
  h.state.rows.productionPlans = kind === "missing" ? [] : [{ id: "plan", orgId: "b" }];
  await expect(createIndent({ ...input, linkedPlanId: "plan", reason: "Production_Shortage" })).rejects.toThrow("Linked plan nahi mila");
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.state.rows.indents).toEqual([]);
  expect(h.state.events).toContain("read:productionPlans:true");
});

it.each([Infinity, -Infinity, NaN, -0.25])("rejects invalid suggested quantity %s before persistence", async (suggestedQty) => {
  await expect(createIndent({ ...input, suggestedQty })).rejects.toMatchObject({ name: "IndentAdmissionError", status: 400 });
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.state.rows.indents).toEqual([]);
});

it.each([Infinity, -Infinity, NaN, 0, -0.25])("rejects invalid final quantity %s before persistence", async (finalQty) => {
  await expect(createIndent({ ...input, finalQty })).rejects.toMatchObject({ name: "IndentAdmissionError", status: 400 });
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.state.rows.indents).toEqual([]);
});

it("uses each tenant's authoritative item metadata for a shared SKU", async () => {
  h.state.rows.items = [item("b", "Tenant B", "m"), item("a", "Tenant A", "kg")];
  const a = await createIndent(input);
  h.state.org = "b";
  const b = await createIndent(input);
  expect(a).toMatchObject({ SKU: "shared", Item_Name: "Tenant A", UOM: "kg", Final_Qty: "1.25", Suggested_Qty: "0" });
  expect(b).toMatchObject({ SKU: "shared", Item_Name: "Tenant B", UOM: "m" });
  expect(h.state.rows.indents.map((row) => row.orgId)).toEqual(["a", "b"]);
  expect(h.state.events).toEqual(["admit:a", "read:items:true", "write:indents:true", "commit", "admit:b", "read:items:true", "write:indents:true", "commit"]);
});

it.each(["missing", "foreign-only"])("rejects %s SKU without writing an indent", async (kind) => {
  h.state.rows.items = kind === "missing" ? [] : [item("b")];
  await expect(createIndent(input)).rejects.toThrow("Item nahi mila");
  expect(h.state.rows.indents).toEqual([]);
  expect(h.insert).not.toHaveBeenCalled();
  expect(h.state.events).toContain("read:items:true");
});
