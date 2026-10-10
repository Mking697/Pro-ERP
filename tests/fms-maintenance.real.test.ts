import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
const b=vi.hoisted(() => ({org:"",activityFault:false,templateDeleteFault:false,recheck:vi.fn()}));
// Normal writes use actual PG; only provider boundaries and explicit failures are mocked.
vi.mock("@/db/client", async actual => {
  const real=await actual<typeof import("@/db/client")>();
  const {maintenanceActivities,fmsTemplates}=await import("@/db/schema");
  return {...real,db:new Proxy(real.db,{ get(target,key) {
    if(key === "insert") return (table: Parameters<typeof target.insert>[0]) => {
      if(table === maintenanceActivities && b.activityFault) throw new Error("activity failure");
      return target.insert(table);
    };
    if(key === "delete") return (table: Parameters<typeof target.delete>[0]) => {
      if(table === fmsTemplates && b.templateDeleteFault) throw new Error("template delete failure");
      return target.delete(table);
    };
    return Reflect.get(target,key);
  }})};
});
vi.mock("@/lib/tenant",() => ({getTenantOrgId:async () => b.org}));
vi.mock("@/lib/orders/orders",() => ({recheckShortfallForSku:b.recheck}));
vi.mock("@/lib/inventory/items",async actual => ({...await actual<object>(),findItem:async (sku:string) => ({SKU:sku,UOM:"pcs",Location:""})}));
vi.mock("@/lib/fms/calendar",() => ({computeNextWorkingInstant:async (_u:string,ms:number) => ms,computeTatDeadline:async (_u:string,ms:number) => ms+60000,computeUserDayEnd:async () => null,computeWorkingMinutesBetween:async () => 5}));
vi.mock("@/lib/chatxflow",() => ({sendWhatsAppMessage:vi.fn()}));
import {db,runInTenantTransaction} from "@/db/client";
import {organizations,stockLedger,productionPlans,planMaterials,fmsRuns,fmsTemplates,maintenanceRequests,maintenanceActivities,mutationReceipts} from "@/db/schema";
import {startFmsInstance,completeFmsStep} from "@/lib/fms/engine";
import {completePlan} from "@/lib/inventory/plans";
import {resetAllFmsData} from "@/lib/fms/reset";
import {reportBreakdown,cancelRequest,markFixedByMaintenance,confirmResolved} from "@/lib/maintenance/maintenance";
beforeEach(async () => {
  expect(process.env.DATABASE_URL).toBe("postgresql://pro_erp_test@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable");
  b.org=`item2-${randomUUID()}`; b.activityFault=false; b.templateDeleteFault=false; b.recheck.mockReset();
  await db.insert(organizations).values({id:b.org,orgName:"Disposable item2",slug:b.org,ownerEmail:"item2@example.invalid"});
});
afterEach(async () => {
  b.activityFault=false; b.templateDeleteFault=false;
  for(const table of [maintenanceActivities,maintenanceRequests,mutationReceipts,fmsRuns,fmsTemplates,planMaterials,productionPlans,stockLedger]) {
    await db.delete(table).where(eq(table.orgId,b.org));
    expect(await db.select().from(table).where(eq(table.orgId,b.org))).toEqual([]);
  }
  await db.delete(organizations).where(eq(organizations.id,b.org));
  expect(await db.select().from(organizations).where(eq(organizations.id,b.org))).toEqual([]);
});
async function seed(production=true) {
  const templateId=`${b.org}-line`,planId=`${b.org}-plan`;
  await db.insert(fmsTemplates).values({templateId,orgId:b.org,templateName:"Line",triggerEvent:"MANUAL",stepNo:1,stepName:"Output",assignedTo:"user",tatValue:"1",tatUnit:"Hours",outcomeOptions:"Done",outcomeType:"DONE",actionType:"LEDGER_MOVEMENT",dataSourceType:"FORM",dataSourceConfig:{form:{fields:[{key:"sku",label:"SKU",type:"text",required:true},{key:"qty",label:"Quantity",type:"number",required:true}]}},actionConfig:{Done:{direction:"In",skuField:"sku",qtyField:"qty"}}});
  if(production) await db.insert(productionPlans).values({id:planId,orgId:b.org,productName:"Product",productSku:"FG",plannedQty:"6",actualQty:"6",productionDate:new Date(),status:"In_Production",fmsTemplateId:templateId});
  const run=await startFmsInstance({templateId,contextRef:production?`PRODUCTION_PLANS:${planId}`:"design",startedBy:"user"});
  return {runId:run.Run_ID,planId};
}
const complete=(runId:string) => completeFmsStep({runId,completedBy:"user",outcome:"Done",formData:{sku:"FG",qty:"6"}});
const runs=() => db.select().from(fmsRuns).where(eq(fmsRuns.orgId,b.org));
const requests=() => db.select().from(maintenanceRequests).where(eq(maintenanceRequests.orgId,b.org));
const activities=() => db.select().from(maintenanceActivities).where(eq(maintenanceActivities.orgId,b.org));
const fg=() => db.select().from(stockLedger).where(and(eq(stockLedger.orgId,b.org),eq(stockLedger.sku,"FG")));
async function holdOutput(runId:string) {
  let admitted!:()=>void,release!:()=>void;
  const ready=new Promise<void>(r=>admitted=r),hold=new Promise<void>(r=>release=r);
  b.recheck.mockImplementation(async () => {admitted();await hold;});
  const completion=complete(runId); await ready;
  return {completion,release};
}
it("reset after actual Line output cannot elect PPC as a second FG writer",async () => {
  const {runId,planId}=await seed(); await complete(runId);
  const before=await runs();
  await expect(resetAllFmsData()).rejects.toThrow(/production/i);
  expect(await runs()).toEqual(before);
  await completePlan(planId,"user"); expect(await fg()).toHaveLength(1);
  await expect(complete(runId)).rejects.toThrow(/complete/); expect(await fg()).toHaveLength(1);
});
it("reset waits behind an actual in-flight Line stock action",async () => {
  const {runId,planId}=await seed(); const held=await holdOutput(runId);
  let settled=false; const reset=resetAllFmsData().then(()=>"reset",()=>"blocked").finally(()=>settled=true);
  try {await new Promise(r=>setTimeout(r,80));expect(settled).toBe(false);} finally {held.release();}
  await held.completion; expect(await reset).toBe("blocked");
  await completePlan(planId,"user"); expect(await fg()).toHaveLength(1);
});
it("breakdown racing actual stock completion cannot pause terminal state",async () => {
  const {runId}=await seed(); const held=await holdOutput(runId);
  let settled=false; const report=reportBreakdown({runId,reportedBy:"user",description:"race"}).then(()=>"reported",()=>"blocked").finally(()=>settled=true);
  try {await new Promise(r=>setTimeout(r,80));expect(settled).toBe(false);} finally {held.release();}
  await held.completion; expect(await report).toBe("blocked");
  expect((await runs())[0].status).toMatch(/On Time|Delay Done/); expect(await requests()).toEqual([]);expect(await activities()).toEqual([]); expect(await fg()).toHaveLength(1);
});
it.each(["cancel","resolve"])("late %s cannot reopen an actual completed stock step",async command => {
  const {runId}=await seed(); const req=await reportBreakdown({runId,reportedBy:"user",description:"initial"});
  await cancelRequest(req.id,"user");
  // Legacy leftover open request: closing it must not resurrect terminal stock work.
  await db.insert(maintenanceRequests).values({id:`${b.org}-legacy`,orgId:b.org,kind:"Breakdown",productionLineRunId:runId,reportedBy:"user",status:command === "resolve"?"Fixed_By_Maintenance":"Open",pausedTatDeadline:new Date()});
  const held=await holdOutput(runId); let settled=false;
  const close=(command === "resolve"?confirmResolved({requestId:`${b.org}-legacy`,actorId:"user"}):cancelRequest(`${b.org}-legacy`,"user")).finally(()=>settled=true);
  try {await new Promise(r=>setTimeout(r,80));expect(settled).toBe(false);} finally {held.release();}
  await held.completion; const terminal=(await runs())[0]; await close;
  expect((await runs())[0]).toEqual(terminal);
  if(command === "resolve") expect((await activities()).find(row=>row.requestId === `${b.org}-legacy`)?.message).not.toContain("resume ho gayi");
  await expect(complete(runId)).rejects.toThrow(/complete/); expect(await fg()).toHaveLength(1);
});
it("a breakdown that wins admission prevents completion until cancelled",async () => {
  const {runId}=await seed(); const req=await reportBreakdown({runId,reportedBy:"user",description:"broken"});
  await expect(complete(runId)).rejects.toThrow(/complete/);expect(await fg()).toEqual([]);
  await cancelRequest(req.id,"user");await complete(runId);expect(await fg()).toHaveLength(1);
});
it.each(["report","cancel","resolve"])("%s activity failure rolls back actual PG state",async command => {
  const {runId}=await seed(); let requestId="";
  if(command !== "report") {requestId=(await reportBreakdown({runId,reportedBy:"user",description:"broken"})).id;if(command === "resolve") await markFixedByMaintenance({requestId,fixedBy:"worker"});}
  const before={runs:await runs(),requests:await requests(),activities:await activities()};b.activityFault=true;
  await expect(command === "report"?reportBreakdown({runId,reportedBy:"user",description:"broken"}):command === "cancel"?cancelRequest(requestId,"user"):confirmResolved({requestId,actorId:"user"})).rejects.toThrow("activity failure");
  b.activityFault=false;expect({runs:await runs(),requests:await requests(),activities:await activities()}).toEqual(before);expect(await fg()).toEqual([]);
});
it("design reset rolls back both deletes on a template failure",async () => {
  await seed(false);const before=await runs();b.templateDeleteFault=true;
  await expect(resetAllFmsData()).rejects.toThrow("template delete failure");b.templateDeleteFault=false;expect(await runs()).toEqual(before);
  expect(await resetAllFmsData()).toEqual({templatesDeleted:1,runsDeleted:1});
});
it("maintenance joins an outer transaction without leaking a pause",async () => {
  const {runId}=await seed();
  await expect(runInTenantTransaction(b.org,async () => {await reportBreakdown({runId,reportedBy:"user",description:"nested"});throw new Error("rollback");})).rejects.toThrow("rollback");
  expect((await runs())[0].status).toBe("Pending");expect(await requests()).toEqual([]);expect(await activities()).toEqual([]);
});
