import type { CostCalculation, CostSheet, CostSheetInput, StandardCostRate, StandardCostRateInput } from "./types";
import { CostingError, createSchema, idSchema, standardSchema, updateSchema, versionSchema } from "./validation";
export interface CostActor { orgId: string; actorId: string }
export interface CostingStore {
 authorize(): Promise<CostActor>;
 mutate<T>(actor: CostActor, operation: string, key: string, payload: unknown, work: () => Promise<T>): Promise<T>;
 calculate(input: CostSheetInput): Promise<CostCalculation>;
 get(id: string): Promise<CostSheet | null>;
 list(sku?: string): Promise<CostSheet[]>;
 save(sheet: CostSheet): Promise<void>;
 nextId(): string;
 now(): string;
 standard(input: StandardCostRateInput, actor: CostActor): Promise<StandardCostRate>;
}
export function createCostingService(store: CostingStore) {
 async function mutation<T>(op: string, key: string, payload: unknown, work: (actor: CostActor) => Promise<T>) {
  if (!key) throw new CostingError("Idempotency-Key is required");
  const actor = await store.authorize();
  return store.mutate(actor, "costing.v1." + op, key, payload, async () => { const live = await store.authorize(); if(live.orgId !== actor.orgId || live.actorId !== actor.actorId) throw new CostingError("Forbidden",403); return work(live); });
 }
 async function editable(id: string, version: number) { const sheet = await store.get(id); if(!sheet) throw new CostingError("Cost sheet not found",404); if(sheet.status !== "Draft" || sheet.version !== version) throw new CostingError("Cost sheet is finalized or version is stale; reload",409); return sheet; }
 return {
  async create(raw: unknown, key: string): Promise<CostSheet> { const payload = createSchema.parse(raw); return mutation("create", key, payload, async actor => {
   if(payload.supersedesId) { const parent = await store.get(payload.supersedesId); if(!parent || parent.status !== "Finalized" || parent.productSku !== payload.input.productSku) throw new CostingError("Revision parent must be a finalized sheet of this product",409); }
   const calculation = await store.calculate(payload.input); const prior = await store.list(payload.input.productSku); const now = store.now(); const revision = prior.reduce((n,s) => Math.max(n,s.revision),0) + 1;
   if(revision > 2147483646) throw new CostingError("Revision limit reached",409);
   const sheet: CostSheet = { id: store.nextId(), productSku: calculation.productSku, productName: calculation.productName, revision, status: "Draft", version: 1, calculation, supersedesId: payload.supersedesId ?? null, createdAt: now, createdBy: actor.actorId, updatedAt: now, finalizedAt: null, finalizedBy: null };
   await store.save(sheet); return sheet;
  }); },
  async update(id: string, raw: unknown, key: string): Promise<CostSheet> { idSchema.parse(id); const payload=updateSchema.parse(raw); return mutation("update", key, {id,...payload}, async () => { const previous=await editable(id,payload.expectedVersion); if(previous.productSku !== payload.input.productSku) throw new CostingError("Product SKU cannot change",409); const sheet={...previous,calculation:await store.calculate(payload.input),version:previous.version+1,updatedAt:store.now()}; await store.save(sheet); return sheet; }); },
  async finalize(id: string, raw: unknown, key: string): Promise<CostSheet> { idSchema.parse(id); const payload=versionSchema.parse(raw); return mutation("finalize", key, {id,...payload}, async actor => { const previous=await editable(id,payload.expectedVersion); if(!previous.calculation.complete || previous.calculation.totals.fullCost === null) throw new CostingError("Incomplete cost sheet cannot be finalized",409); const now=store.now(); const sheet: CostSheet={...previous,status:"Finalized",version:previous.version+1,updatedAt:now,finalizedAt:now,finalizedBy:actor.actorId}; await store.save(sheet); return sheet; }); },
  async approveStandard(raw: unknown,key: string): Promise<StandardCostRate> { const payload=standardSchema.parse(raw); return mutation("standard",key,payload, actor => store.standard(payload,actor)); },
 };
}
