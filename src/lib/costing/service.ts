import { translatorFor } from "@/lib/i18n";
const t = translatorFor("en");
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { bom, costSheets, indents, items, purchaseOrderLines, purchaseOrders, standardCostRates, stockLedger } from "@/db/schema";
import { requireModule } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { runIdempotentTenantMutation, type MutationJsonValue } from "@/lib/mutations";
import { calculateCostSheet } from "./engine";
import { createCostingService, type CostingStore } from "./domain";
import { CostingError, idSchema, inputSchema } from "./validation";
import type { CostProduct, CostSheet, CostSheetInput, CostSheetSummary } from "./types";
const dto = (r: typeof costSheets.$inferSelect): CostSheet => ({id:r.id,productSku:r.productSku,productName:r.productName,revision:r.revision,status:r.status,version:r.version,calculation:r.calculation,supersedesId:r.supersedesId,createdAt:r.createdAt.toISOString(),createdBy:r.createdBy,updatedAt:r.updatedAt.toISOString(),finalizedAt:r.finalizedAt?.toISOString() ?? null,finalizedBy:r.finalizedBy});
export async function getProductCostSheet(id: string): Promise<CostSheet | null> {
 idSchema.parse(id); const orgId=await getTenantOrgId(); const [r]=await db.select().from(costSheets).where(and(eq(costSheets.orgId,orgId),eq(costSheets.id,id))).limit(1); return r ? dto(r) : null;
}
async function listSaved(sku?: string): Promise<CostSheet[]> { const orgId=await getTenantOrgId(); const r=await db.select().from(costSheets).where(and(eq(costSheets.orgId,orgId),sku ? eq(costSheets.productSku,sku) : undefined)).orderBy(desc(costSheets.createdAt),desc(costSheets.id)); return r.map(dto); }
export async function listCostSheets(sku?: string): Promise<CostSheetSummary[]> { if(sku !== undefined) idSchema.parse(sku); return (await listSaved(sku)).map(s => ({ id:s.id,productSku:s.productSku,productName:s.productName,revision:s.revision,status:s.status,version:s.version,asOfDate:s.calculation.input.asOfDate,batchQty:s.calculation.input.batchQty,totalCost:s.calculation.totals.fullCost,createdAt:s.createdAt })); }
export async function getCostCatalog(): Promise<CostProduct[]> {
 const orgId=await getTenantOrgId(); const masters=await db.select({sku:items.sku,name:items.itemName,uom:items.uom,category:items.category}).from(items).where(eq(items.orgId,orgId)); const active=await db.select({sku:bom.productSku,bomId:bom.bomId,version:bom.version}).from(bom).where(and(eq(bom.orgId,orgId),eq(bom.status,"Active")));
 return masters.filter(i => i.category === "FG" || i.category === "Semi-FG" || active.some(b => b.sku === i.sku)).map(i => { const bs=active.filter(b => b.sku===i.sku); const unique=new Set(bs.map(b => b.bomId+"\u0000"+b.version)); return {sku:i.sku,name:i.name,uom:i.uom,bomId:unique.size===1?bs[0].bomId:null,bomVersion:unique.size===1?bs[0].version:null}; }).sort((a,b)=>a.sku.localeCompare(b.sku));
}
export async function previewCostSheet(raw: CostSheetInput) {
 const input=inputSchema.parse(raw),orgId=await getTenantOrgId();
 const [product]=await db.select({sku:items.sku,name:items.itemName,uom:items.uom}).from(items).where(and(eq(items.orgId,orgId),eq(items.sku,input.productSku))).limit(1);
 if(!product) throw new CostingError("Product item master not found",404);
 const components=await db.select().from(bom).where(and(eq(bom.orgId,orgId),eq(bom.productSku,input.productSku),eq(bom.status,"Active")));
 const skus=[...new Set(components.map(b=>b.componentSku))];
 if(!skus.length) throw new CostingError("No active BOM for this product SKU");
 const masters=await db.select({sku:items.sku,name:items.itemName,uom:items.uom}).from(items).where(and(eq(items.orgId,orgId),inArray(items.sku,skus)));
 // receiveIndent appends one In/Indent_Receipt movement per partial receipt;
 // indents.receivedAt is only the mutable timestamp of the LAST receipt.
 // The writer links a PO only to an Approved, unlinked indent, and a received
 // indent cannot be relinked. Retain the exact tenant/SKU/UOM/reference chain.
 const purchases=await db.select({id:purchaseOrderLines.id,sku:indents.sku,uom:indents.uom,receivedQty:stockLedger.quantity,receivedAt:stockLedger.timestamp,receiptId:stockLedger.id,newPrice:purchaseOrderLines.newPrice,oldPrice:purchaseOrderLines.oldPrice,status:purchaseOrders.status,indentStatus:indents.status,poId:purchaseOrders.id,indentId:indents.id}).from(indents)
 .innerJoin(purchaseOrderLines,and(eq(purchaseOrderLines.orgId,orgId),eq(purchaseOrderLines.indentId,indents.id),eq(purchaseOrderLines.poId,indents.poId),eq(purchaseOrderLines.sku,indents.sku)))
 .innerJoin(purchaseOrders,and(eq(purchaseOrders.orgId,orgId),eq(purchaseOrders.id,purchaseOrderLines.poId)))
 .leftJoin(stockLedger,and(eq(stockLedger.orgId,orgId),eq(stockLedger.referenceId,indents.id),eq(stockLedger.sku,indents.sku),eq(stockLedger.uom,indents.uom),eq(stockLedger.source,"Indent_Receipt"),eq(stockLedger.direction,"In")))
 .where(and(eq(indents.orgId,orgId),inArray(indents.sku,skus)));
 const linesByReceipt=new Map<string,Set<string>>();
 for(const p of purchases) if(p.receiptId) { const lines=linesByReceipt.get(p.receiptId)??new Set<string>(); lines.add(p.id); linesByReceipt.set(p.receiptId,lines); }
 const ambiguous=new Set([...linesByReceipt].filter(([,lines])=>lines.size!==1).map(([id])=>id));
 const sourceWarnings=purchases.filter(p=>!p.receiptId || ambiguous.has(p.receiptId)).map(p=>`${p.sku}: Purchase receipt event history is missing or ambiguous for indent ${p.indentId}; cumulative receipt dates are not historical evidence. Only an explicit approved standard may be used instead.`);
 const standards=await db.select().from(standardCostRates).where(and(eq(standardCostRates.orgId,orgId),inArray(standardCostRates.sku,skus)));
 return calculateCostSheet(input,{product,bom:components,items:masters,sourceWarnings:[...new Set(sourceWarnings)],purchases:purchases.filter(p=>p.receiptId && !ambiguous.has(p.receiptId)).map(p=>({...p,receivedAt:p.receivedAt?.toISOString()??null,description:t("INR agreed PO") + ` ${p.poId}; ` + t("received indent") + ` ${p.indentId}; ${p.receiptId}`})),standards:standards.map(s=>({...s,approvedAt:s.approvedAt.toISOString()}))});
}
const store: CostingStore = {
 authorize: async () => { const guard=await requireModule("COST_SHEETS"); if(!guard.ok) throw new CostingError("Costing access denied",guard.response.status); if(guard.tenant.orgId !== await getTenantOrgId()) throw new CostingError("Tenant mismatch",403); return {orgId:guard.tenant.orgId,actorId:guard.session.userId}; },
 mutate: async (actor,operation,key,payload,work) => {
  // The primitive admits/locks the tenant before executing work. Domain rechecks
  // live token/grant in that transaction; every persisted write uses the active db.
  return await runIdempotentTenantMutation(actor.orgId,{operation,actorId:actor.actorId,key,payload:payload as MutationJsonValue},work as () => Promise<MutationJsonValue>) as never;
 },
 calculate:previewCostSheet,get:getProductCostSheet,list:listSaved,nextId:()=>generateId("CST"),now:()=>new Date().toISOString(),
 save:async sheet => { const orgId=await getTenantOrgId(); const row={...sheet,orgId,createdAt:new Date(sheet.createdAt),updatedAt:new Date(sheet.updatedAt),finalizedAt:sheet.finalizedAt?new Date(sheet.finalizedAt):null};
  if(sheet.version===1) await db.insert(costSheets).values(row);
  else { const result=await db.update(costSheets).set({calculation:row.calculation,status:row.status,version:row.version,updatedAt:row.updatedAt,finalizedAt:row.finalizedAt,finalizedBy:row.finalizedBy}).where(and(eq(costSheets.orgId,orgId),eq(costSheets.id,sheet.id),eq(costSheets.status,"Draft"),eq(costSheets.version,sheet.version-1))).returning({id:costSheets.id}); if(!result.length) throw new CostingError("Cost sheet is finalized or version is stale",409); }
 },
 standard:async (input,actor) => { const [item]=await db.select({uom:items.uom}).from(items).where(and(eq(items.orgId,actor.orgId),eq(items.sku,input.sku))).limit(1); if(!item || !item.uom || item.uom !== input.uom) throw new CostingError("Standard rate must use the existing item master UOM"); const rate={...input,id:generateId("CSR"),approvedBy:actor.actorId,approvedAt:new Date().toISOString()}; await db.insert(standardCostRates).values({...rate,orgId:actor.orgId,approvedAt:new Date(rate.approvedAt)}); return rate; },
};
export const costingService=createCostingService(store);
