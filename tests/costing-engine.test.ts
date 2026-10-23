import { describe, expect, it } from "vitest";
import { calculateCostSheet } from "@/lib/costing/engine";
import { input, facts } from "./costing-fixtures";
describe("estimated calculation", () => {
 it("multiplies exactly and rounds once per material line", () => { const c = calculateCostSheet(input, facts); expect(c.materials[0].requiredQty).toBe("0.3"); expect(c.totals.fullCost).toBe("0.05"); expect(c.totals.perUnit).toBe("0.02"); expect(c.complete).toBe(true); });
});
describe("source integrity and costing boundaries", () => {
 it("never values a cancelled receipt even if its PO remains open", () => {
  const c = calculateCostSheet(input, { ...facts, purchases: facts.purchases.map(p => ({ ...p, indentStatus: "Cancelled" })) });
  expect(c.complete).toBe(false); expect(c.materials[0].rate).toBeNull();
 });
 it("preserves explicit zero rates and excludes future receipt dates in IST", () => {
  const future = { ...facts.purchases[0], id: "future", receivedAt: "2026-10-23T18:30:00.000Z", newPrice: "99" };
  const c = calculateCostSheet(input, { ...facts, purchases: [...facts.purchases.map(p => ({ ...p, newPrice: "0" })), future] });
  expect(c.materials[0].rate).toBe("0"); expect(c.totals.fullCost).toBe("0.00"); expect(c.complete).toBe(true);
 });
 it("uses only compatible approved standards and preserves missing totals", () => {
  const standard = { id:"R", sku:"RM", uom:"Kg", rate:"7", effectiveDate:"2026-10-22", reason:"Approved", approvedAt:"2026-10-23T00:00:00Z", approvedBy:"U" };
  const c = calculateCostSheet(input, { ...facts, purchases: [], standards: [standard, { ...standard, id:"future", effectiveDate:"2026-10-24", rate:"99" }] });
  expect(c.materials[0].source.id).toBe("R"); expect(c.totals.fullCost).toBe("2.10");
  const missing = calculateCostSheet(input, { ...facts, purchases: [], standards: [{ ...standard, uom:"Nos" }] });
  expect(missing.totals.knownMaterialSubtotal).toBe("0.00"); expect(missing.totals.fullCost).toBeNull(); expect(missing.totals.material).toBeNull();
 });
 it("does not compare mismatched UOMs or invent generic item prices", () => {
  expect(calculateCostSheet(input, { ...facts, items:[{sku:"RM",name:"Steel",uom:"g"}] }).complete).toBe(false);
 });
 it("separates manufacturing from commercial with explicit allocation bases", () => {
  const c = calculateCostSheet({ ...input, charges:[
   {head:"Labour",description:"Assembly",basis:"LabourHours",quantity:"2.5",rate:"100"},
   {head:"DirectExpense",description:"Service",basis:"Batch",quantity:"99",rate:"10"},
   {head:"FactoryOverhead",description:"Machine",basis:"MachineHours",quantity:"0.5",rate:"40"},
   {head:"Commercial",description:"Packing",basis:"PerUnit",quantity:"99",rate:"2"},
  ] }, facts);
  expect(c.totals.manufacturing).toBe("280.05"); expect(c.totals.fullCost).toBe("286.05"); expect(c.totals.perUnit).toBe("95.35");
 });
 it.each(["NaN","Infinity","-1","1e3","0","1000000000","0.0000001"])("rejects invalid batch quantity %s",batchQty=>{
  expect(()=>calculateCostSheet({...input,batchQty},facts)).toThrow();
 });
 it("rejects duplicate components and ambiguous active BOM versions",()=>{
  expect(()=>calculateCostSheet(input,{...facts,bom:[...facts.bom,...facts.bom]})).toThrow();
  expect(()=>calculateCostSheet(input,{...facts,bom:[...facts.bom,{...facts.bom[0],bomId:"B2",componentSku:"RM2"}]})).toThrow();
 });
});
export { input, facts };
