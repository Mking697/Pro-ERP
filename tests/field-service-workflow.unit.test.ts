import { beforeEach, describe, expect, it, vi } from "vitest";
import { fieldTaskAssignments, fieldTaskSteps, users } from "@/db/schema";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const h = vi.hoisted(() => ({ task: {id:"t",customerId:"c",currentCycle:1,status:"Assigned"}, step: null as Record<string,unknown>|null, userRows: [{id:"u",fullName:"Doer",phoneNumber:"123",status:"Active",role:"Doer"}], assigned:true, writes:0, committed:0, effects:[] as (()=>Promise<void>)[], failActivity:false, predicates:[] as unknown[] }));
vi.mock("@/db/client", () => {
 const builder = (rows: unknown[]) => { const b: Record<string,unknown> = {}; for (const method of ["where","limit","orderBy"]) b[method] = (...args:unknown[]) => { if(method === "where") h.predicates.push(args[0]); return b; }; b.then=(resolve:(v:unknown)=>unknown)=>Promise.resolve(rows).then(resolve); return b; };
 return { db: { select:()=>({from:(table:unknown)=>builder(table===users?h.userRows:table===fieldTaskAssignments?(h.assigned?[{id:"a",doerId:"u",cycle:1}]:[]):table===fieldTaskSteps?(h.step?[h.step]:[]):[])}), insert:()=>({values:(v:Record<string,unknown>)=>{h.writes++; h.step={...v}; return {onConflictDoUpdate:()=>Promise.resolve(),returning:()=>Promise.resolve([h.step]),then:(f:(v:unknown)=>unknown)=>Promise.resolve().then(f)};}}), update:()=>({set:(v:Record<string,unknown>)=>({where:(p:unknown)=>{h.predicates.push(p); h.writes++; h.step={...h.step,...v};return {returning:()=>Promise.resolve([h.step]),then:(f:(v:unknown)=>unknown)=>Promise.resolve().then(f)};}})}), delete:()=>({where:()=>{h.writes++; return Promise.resolve();}}) }, runInTenantTransaction: async (_org:string,fn:()=>Promise<unknown>)=>{const before={writes:h.writes,step:h.step,task:{...h.task}}; h.effects=[]; try {const r=await fn();h.committed++;for(const effect of h.effects) await effect();return r;} catch(e){h.writes=before.writes;h.step=before.step;h.task=before.task;h.effects=[];throw e;}}, afterTenantCommit:async(fn:()=>Promise<void>)=>{h.effects.push(fn);} };
});
vi.mock("@/db/repo",()=>({insertRecord:async()=>{h.writes++;return {};}}));
vi.mock("@/lib/fieldService/core",()=>({FIELD_TASK_TYPE_LABEL:{SERVICE:"Service",COMPLAINT:"Complaint",SITE_VISIT:"Site visit"},getFieldTaskCore:async()=>h.task,updateFieldTaskCore:async(_org:string,_type:string,_id:string,patch:object)=>{h.writes++;Object.assign(h.task,patch);},logFieldServiceActivity:async()=>{if(h.failActivity)throw Error("activity failure");}}));
vi.mock("@/lib/auth/users",()=>({getUserById:async()=>({User_ID:"u",Full_Name:"Doer",Status:h.userRows[0]?.status,Phone_Number:"123"}),listUsers:async()=>[]}));
vi.mock("@/lib/chatxflow",()=>({sendWhatsAppMessage:vi.fn(async()=>({ok:true}))}));
import { submitStep1, submitStep2, submitStep3 } from "@/lib/fieldService/steps";
import { assignDoers, unassignDoer } from "@/lib/fieldService/assignments";
import { sendWhatsAppMessage } from "@/lib/chatxflow";
const photo = {sitePhotoUrl:"/uploads/orgs/org-a/ATT-123-photo.jpg",latitude:0,longitude:0};
beforeEach(()=>{h.task={id:"t",customerId:"c",currentCycle:1,status:"Assigned"};h.step=null;h.userRows=[{id:"u",fullName:"Doer",phoneNumber:"123",status:"Active",role:"Doer"}];h.assigned=true;h.writes=0;h.committed=0;h.failActivity=false;h.effects=[];h.predicates=[];vi.mocked(sendWhatsAppMessage).mockClear();});
describe("field service transactional writers",()=>{
 it("does not mutate a completed round on repeated step 1",async()=>{h.task.status="Completed";await expect(submitStep1("org-a","SERVICE","t","u",photo,1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("rejects a stale cycle even for an active assignee",async()=>{h.task.currentCycle=2;await expect(submitStep1("org-a","SERVICE","t","u",photo,1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("rejects inactive assignees",async()=>{h.userRows[0].status="Inactive";await expect(submitStep1("org-a","SERVICE","t","u",photo,1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("rejects unassigned users",async()=>{h.assigned=false;await expect(submitStep1("org-a","SERVICE","t","u",photo,1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("rejects repeated step 2",async()=>{h.task.status="In_Progress";h.step={id:"s",step1At:new Date(),step2At:new Date()};await expect(submitStep2("org-a","SERVICE","t","u",{evidenceUrl:photo.sitePhotoUrl},1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("rejects repeated step 3 on completed history",async()=>{h.task.status="Completed";h.step={id:"s",step1At:new Date(),step2At:new Date(),step3At:new Date()};await expect(submitStep3("org-a","SERVICE","t","u",{expenseAmount:0},1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("rolls back steps and task state when activity fails",async()=>{h.failActivity=true;await expect(submitStep1("org-a","SERVICE","t","u",photo,1)).rejects.toThrow();expect(h.writes).toBe(0);expect(h.task.status).toBe("Assigned");expect(sendWhatsAppMessage).not.toHaveBeenCalled();});
 it("rejects assigning inactive or foreign users before reopening",async()=>{h.task.status="Completed";h.userRows=[];await expect(assignDoers("org-a","SERVICE","t",["foreign"],null,"","staff",1)).rejects.toThrow();expect(h.task.currentCycle).toBe(1);expect(h.writes).toBe(0);});
 it("never unassigns a completed round",async()=>{h.task.status="Completed";await expect(unassignDoer("org-a","SERVICE","t","u","staff",1)).rejects.toThrow();expect(h.writes).toBe(0);});
 it("defers assignment notification until committed",async()=>{await assignDoers("org-a","SERVICE","t",["u"],0,"","staff",1);expect(h.committed).toBe(1);expect(sendWhatsAppMessage).toHaveBeenCalledOnce();});
});

it("rejects stale assignment requests without reopening or writing",async()=>{h.task.currentCycle=2;await expect(assignDoers("org-a","SERVICE","t",["u"],0,"","staff",1)).rejects.toThrow();expect(h.writes).toBe(0);});
it("rejects stale unassignment requests without deleting",async()=>{h.task.currentCycle=2;await expect(unassignDoer("org-a","SERVICE","t","u","staff",1)).rejects.toThrow();expect(h.writes).toBe(0);});
it("rejects assignment mutations without an exact expected cycle",async()=>{await expect(assignDoers("org-a","SERVICE","t",["u"],0,"","staff",undefined as unknown as number)).rejects.toThrow();expect(h.writes).toBe(0);});

it("commits valid step 1 and progresses the task once",async()=>{const result=await submitStep1("org-a","SERVICE","t","u",photo,1);expect(h.committed).toBe(1);expect(h.task.status).toBe("In_Progress");expect(result.cycle).toBe(1);expect(result.sitePhotoUrl).toBe(photo.sitePhotoUrl);expect(result.step1At).toBeTruthy();});
it("completes step 3 only from step 2 in the same cycle",async()=>{h.task.status="In_Progress";h.step={id:"s",orgId:"org-a",taskType:"SERVICE",taskId:"t",cycle:1,step1At:new Date(),step2At:new Date(),step3At:null,latitude:null,longitude:null,expenseAmount:null};const result=await submitStep3("org-a","SERVICE","t","u",{expenseAmount:0},1);expect(result.step3At).toBeTruthy();expect(result.expenseAmount).toBe(0);expect(h.task.status).toBe("Completed");expect(h.committed).toBe(1);const predicates=h.predicates.map(p=>new PgDialect().sqlToQuery(p as SQL).params);expect(predicates).toContainEqual(["org-a","SERVICE","t",1,"s"]);});
it("rolls back assignment and suppresses WhatsApp on activity failure",async()=>{h.failActivity=true;await expect(assignDoers("org-a","SERVICE","t",["u"],0,"","staff",1)).rejects.toThrow("activity failure");expect(h.writes).toBe(0);expect(sendWhatsAppMessage).not.toHaveBeenCalled();});
