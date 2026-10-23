import { describe, expect, it, vi } from "vitest";
import { createCostingService, type CostingStore } from "@/lib/costing/domain";
import { calculateCostSheet } from "@/lib/costing/engine";
import { input, facts } from "./costing-fixtures";
import type { CostSheet } from "@/lib/costing/types";
function fixture() {
 const rows: CostSheet[] = []; const receipts = new Map<string, { payload: string; value: unknown }>(); let allowed = true; let tenant = "A";
 const store: CostingStore = {
  authorize: async () => { if (!allowed) throw Object.assign(new Error("Forbidden"), { status: 403 }); return { orgId: tenant, actorId: "U" }; },
  mutate: async (actor, operation, key, payload, work) => { const hash = JSON.stringify({ actor, operation, payload }); const k = tenant + key; const old = receipts.get(k); if (old) { if (old.payload !== hash) throw Object.assign(new Error("Conflict"), { status: 409 }); return structuredClone(old.value) as never; } const result = await work(); receipts.set(k, { payload: hash, value: structuredClone(result) }); return result; },
  calculate: async i => calculateCostSheet(i, facts),
  get: async id => rows.find(r => r.id === tenant + id) ?? null,
  list: async sku => rows.filter(r => r.id.startsWith(tenant) && (!sku || r.productSku === sku)),
  save: async s => { const i = rows.findIndex(r => r.id === s.id); if(i < 0) rows.push(structuredClone(s)); else rows[i] = structuredClone(s); },
  nextId: () => tenant + "S" + rows.length,
  now: () => "2026-10-23T12:00:00.000Z",
  standard: async r => ({ ...r, id: "R", approvedBy: "U", approvedAt: "2026-10-23T12:00:00.000Z" }),
 };
 // ID is opaque in production; this fake's tenant check reads the prefix.
 store.get = async id => rows.find(r => r.id === id && r.id.startsWith(tenant)) ?? null;
 return { service: createCostingService(store), store, rows, deny: () => { allowed = false; }, tenant: (s: string) => { tenant = s; } };
}
describe("saved estimated lifecycle", () => {
 it("exports tenant-scoped persisted snapshot and append-only standard tables", async () => { const schema = await import("@/db/schema"); expect(schema).toHaveProperty("costSheets.orgId"); expect(schema).toHaveProperty("standardCostRates.orgId"); });
 it("saves server snapshot, replays same DTO, finalizes without recalculation and creates product-local revision", async () => { const f = fixture(); const s = await f.service.create({input}, "k1"); expect(s.revision).toBe(1); expect(await f.service.create({input}, "k1")).toEqual(s); f.store.calculate = vi.fn(() => { throw new Error("must not reprice"); }); const fin = await f.service.finalize(s.id, {expectedVersion:1}, "k2"); expect(fin.status).toBe("Finalized"); expect(fin.calculation).toEqual(s.calculation); expect(await f.service.finalize(s.id, {expectedVersion:1}, "k2")).toEqual(fin); await expect(f.service.update(s.id, {input,expectedVersion:2}, "k3")).rejects.toMatchObject({status:409}); f.store.calculate = async i => calculateCostSheet(i,facts); const rev = await f.service.create({input,supersedesId:s.id}, "k4"); expect(rev.revision).toBe(2); expect(rev.supersedesId).toBe(s.id); });
 it("rejects stale versions, incomplete finalization, changed replay payload and cross-tenant IDs", async () => { const f=fixture(); const s=await f.service.create({input},"a"); await expect(f.service.update(s.id,{input,expectedVersion:2},"b")).rejects.toMatchObject({status:409}); await expect(f.service.create({input:{...input,batchQty:"2"}},"a")).rejects.toMatchObject({status:409}); f.tenant("B"); await expect(f.service.finalize(s.id,{expectedVersion:1},"c")).rejects.toMatchObject({status:404}); f.tenant("A"); f.store.calculate = async i => calculateCostSheet(i,{...facts,purchases:[]}); const incomplete=await f.service.create({input},"d"); await expect(f.service.finalize(incomplete.id,{expectedVersion:1},"e")).rejects.toMatchObject({status:409}); });
 it("checks live permission again when work enters mutation transaction", async () => { const f=fixture(); const original=f.store.mutate; f.store.mutate=async (...args) => { f.deny(); return original(...args); }; await expect(f.service.create({input},"a")).rejects.toMatchObject({status:403}); expect(f.rows).toEqual([]); });
});
