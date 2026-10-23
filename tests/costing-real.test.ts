import { beforeAll, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
// Mock the request/cookie boundary only. Real tenant ALS, SDK, SQL, transactions,
// receipts, source joins and persistence are executed. This is not login acceptance.
const auth = vi.hoisted(() => ({ orgId:"COST-A", actorId:"QA-ADMIN", allowed:true }));
vi.mock("@/lib/auth/guard", () => ({ requireModule: async () => auth.allowed ? {ok:true,session:{userId:auth.actorId},tenant:{orgId:auth.orgId}} : {ok:false,response:Response.json({error:"Forbidden"},{status:403})} }));
import { db } from "@/db/client";
import { organizations, items, bom, purchaseOrders, purchaseOrderLines, indents, costSheets, mutationReceipts, standardCostRates, stockLedger } from "@/db/schema";
import { runWithTenant, tenantFromOrgId } from "@/lib/tenant";
import { costingService, getProductCostSheet, previewCostSheet } from "@/lib/costing/service";
import { input } from "./costing-fixtures";
async function tenant<T>(orgId: string, work: () => Promise<T>) { return runWithTenant(await tenantFromOrgId(orgId), work); }
beforeAll(async()=>{
 await db.insert(organizations).values(["COST-A","COST-B"].map(id=>({id,orgName:id,slug:id.toLowerCase(),ownerEmail:id+"@example.invalid",plan:"Enterprise"})));
 for(const orgId of ["COST-A","COST-B"]){
  await db.insert(items).values([{orgId,sku:"FG",itemName:"Widget",category:"FG",uom:"Nos"},{orgId,sku:"RM",itemName:"Steel",category:"Raw Material",uom:"Kg"}]);
  await db.insert(bom).values({bomId:orgId+"B",orgId,productName:"Widget",productSku:"FG",version:"1",lineNo:"1",componentSku:"RM",componentName:"Steel",qtyPerUnit:"2",uom:"Kg"});
 }
 await db.insert(purchaseOrders).values({id:"PO-A",orgId:"COST-A",vendorId:"Vendor",status:"Open"});
 await db.insert(indents).values({id:"IND-A",orgId:"COST-A",sku:"RM",uom:"Kg",finalQty:"15",receivedQty:"10",receivedAt:new Date("2026-10-21T00:00:00Z"),status:"Partially_Received",poId:"PO-A"});
 await db.insert(purchaseOrderLines).values({id:"POL-A",orgId:"COST-A",poId:"PO-A",indentId:"IND-A",sku:"RM",newPrice:"12.50",oldPrice:"10"});
 await db.insert(stockLedger).values({id:"TX-A1",orgId:"COST-A",sku:"RM",uom:"Kg",source:"Indent_Receipt",direction:"In",referenceId:"IND-A",quantity:"10",timestamp:new Date("2026-10-21T00:00:00Z")});
});
it("real source join, immutable finalize, exact replay and readback persist; foreign tenant sees neither sheet nor rate",async()=>{
 auth.orgId="COST-A";
 const saved=await tenant("COST-A",()=>costingService.create({input},"create-1"));
 expect(saved.calculation.totals.fullCost).toBe("75.00");expect(saved.calculation.materials[0].source.id).toBe("POL-A");
 expect(await tenant("COST-A",()=>getProductCostSheet(saved.id))).toEqual(saved);
 const finalized=await tenant("COST-A",()=>costingService.finalize(saved.id,{expectedVersion:1},"final-1"));
 expect(await tenant("COST-A",()=>costingService.finalize(saved.id,{expectedVersion:1},"final-1"))).toEqual(finalized);
 await db.update(purchaseOrderLines).set({newPrice:"20"}).where(eq(purchaseOrderLines.id,"POL-A"));
 expect((await tenant("COST-A",()=>getProductCostSheet(saved.id)))?.calculation.totals.fullCost).toBe("75.00");
 await expect(tenant("COST-A",()=>costingService.update(saved.id,{input,expectedVersion:2},"edit-final"))).rejects.toMatchObject({status:409});
 const revision=await tenant("COST-A",()=>costingService.create({input,supersedesId:saved.id},"revision-1"));
 expect(revision.revision).toBe(2);expect(revision.calculation.totals.fullCost).toBe("120.00");
 auth.orgId="COST-B";
 expect(await tenant("COST-B",()=>getProductCostSheet(saved.id))).toBeNull();
 expect((await tenant("COST-B",()=>previewCostSheet(input))).complete).toBe(false);
 await expect(tenant("COST-B",()=>costingService.finalize(saved.id,{expectedVersion:2},"foreign"))).rejects.toMatchObject({status:404});
 auth.orgId="COST-A";
});
it("concurrent identical create admits one write/receipt, while distinct creates get unique product-local revisions",async()=>{
 const [a,b]=await Promise.all([tenant("COST-A",()=>costingService.create({input},"race-same")),tenant("COST-A",()=>costingService.create({input},"race-same"))]);expect(a).toEqual(b);
 const receipt=await db.select().from(mutationReceipts).where(and(eq(mutationReceipts.orgId,"COST-A"),eq(mutationReceipts.key,"race-same")));expect(receipt).toHaveLength(1);
 const rows=await db.select().from(costSheets).where(eq(costSheets.id,a.id));expect(rows).toHaveLength(1);
 const distinct=await Promise.all([tenant("COST-A",()=>costingService.create({input},"race-a")),tenant("COST-A",()=>costingService.create({input},"race-b"))]);
 expect(new Set(distinct.map(s=>s.revision)).size).toBe(2);
 await expect(tenant("COST-A",()=>costingService.create({input:{...input,batchQty:"4"}},"race-same"))).rejects.toMatchObject({status:409});
});
it("failed standard approval and failed snapshot insert roll back business rows and replay receipts",async()=>{
 await expect(tenant("COST-A",()=>costingService.approveStandard({sku:"RM",uom:"g",rate:"1",effectiveDate:"2026-10-23",reason:"Mismatch"},"bad-uom"))).rejects.toMatchObject({status:400});
 expect(await db.select().from(standardCostRates)).toHaveLength(0);
 await db.execute(sql`CREATE FUNCTION qa_reject_cost() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA write rejection'; END $$`);
 await db.execute(sql`CREATE TRIGGER qa_cost_reject BEFORE INSERT ON cost_sheets FOR EACH ROW EXECUTE FUNCTION qa_reject_cost()`);
 try { await expect(tenant("COST-A",()=>costingService.create({input},"force-rollback"))).rejects.toThrow(); }
 finally { await db.execute(sql`DROP TRIGGER qa_cost_reject ON cost_sheets`);await db.execute(sql`DROP FUNCTION qa_reject_cost()`); }
 expect(await db.select().from(mutationReceipts).where(eq(mutationReceipts.key,"force-rollback"))).toHaveLength(0);
 expect(await db.select().from(mutationReceipts).where(eq(mutationReceipts.key,"bad-uom"))).toHaveLength(0);
 // The same key can succeed after a rolled-back attempt, proving no phantom receipt.
 expect((await tenant("COST-A",()=>costingService.create({input},"force-rollback"))).id).toBeTruthy();
});
it("approved zero standards, missing rates, stale versions and revoked grant fail closed on real persistence",async()=>{
 auth.orgId="COST-B";
 const draft=await tenant("COST-B",()=>costingService.create({input},"missing"));expect(draft.calculation.totals.fullCost).toBeNull();
 await expect(tenant("COST-B",()=>costingService.finalize(draft.id,{expectedVersion:1},"incomplete"))).rejects.toMatchObject({status:409});
 await tenant("COST-B",()=>costingService.approveStandard({sku:"RM",uom:"Kg",rate:"0",effectiveDate:"2026-10-23",reason:"QA free issue"},"zero"));
 const updated=await tenant("COST-B",()=>costingService.update(draft.id,{input,expectedVersion:1},"update-zero"));expect(updated.calculation.totals.fullCost).toBe("0.00");
 await expect(tenant("COST-B",()=>costingService.update(draft.id,{input,expectedVersion:1},"stale"))).rejects.toMatchObject({status:409});
 auth.allowed=false;
 await expect(tenant("COST-B",()=>costingService.finalize(draft.id,{expectedVersion:2},"denied"))).rejects.toMatchObject({status:403});
 auth.allowed=true;expect((await tenant("COST-B",()=>getProductCostSheet(draft.id)))?.status).toBe("Draft");auth.orgId="COST-A";
});
it("historical purchase rates survive later receipt timestamps on the same indent",async()=>{
 auth.orgId="COST-A";
 await tenant("COST-A",()=>costingService.approveStandard({sku:"RM",uom:"Kg",rate:"10",effectiveDate:"2026-10-01",reason:"QA fallback"},"historical-standard"));
 const historical={...input,asOfDate:"2026-10-22"};
 const before=await tenant("COST-A",()=>previewCostSheet(historical));
 expect(before.materials[0].rate).toBe("20");
 await db.insert(stockLedger).values({id:"TX-A2",orgId:"COST-A",sku:"RM",uom:"Kg",source:"Indent_Receipt",direction:"In",referenceId:"IND-A",quantity:"5",timestamp:new Date("2026-10-23T00:00:00Z")});
 await db.update(indents).set({receivedQty:"15",receivedAt:new Date("2026-10-23T00:00:00Z"),status:"Received"}).where(eq(indents.id,"IND-A"));
 const after=await tenant("COST-A",()=>previewCostSheet(historical));
 expect(after.materials[0]).toEqual(before.materials[0]);
 expect(after.materials[0].source).toMatchObject({kind:"Purchase",id:"POL-A",date:"2026-10-21T00:00:00.000Z"});
 expect(after.materials[0].source.description).toContain("TX-A1");
});
