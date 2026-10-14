import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(()=>({ suspended:false, staff:false, assigned:true, orgs:[] as string[], stepCalls:0 }));
vi.mock("@/lib/auth/guard",()=>({requireSession:async()=>({ok:true,session:{orgId:"org-a",userId:"u",role:"Doer",access:h.staff?["SERVICE_FMS"]:[]}})}));
vi.mock("@/lib/tenant",()=>({TenantResolutionError:class extends Error{},tenantFromOrgId:async(org:string)=>{h.orgs.push(org);if(h.suspended){const {TenantResolutionError}=await import("@/lib/tenant");throw new TenantResolutionError("Suspended");}return {orgId:org,org:{id:org,plan:"Pro"}};},runWithTenant:async(_ctx:unknown,fn:()=>Promise<unknown>)=>fn()}));
vi.mock("@/lib/platform/planLimits",()=>({moduleAllowedForPlan:()=>true}));
vi.mock("@/lib/fieldService/core",()=>({getFieldTaskCore:async()=>({id:"t",status:"Assigned",currentCycle:2})}));
vi.mock("@/lib/fieldService/assignments",()=>({FieldAssignmentError:class extends Error{},isTaskAssignedToDoer:async()=>h.assigned,isTaskAssignedToDoerInCycle:async()=>h.assigned}));
vi.mock("@/lib/fieldService/steps",()=>({FieldStepError:class extends Error{},getStep:async()=>null,getTaskHistory:async()=>[],submitStep1:async()=>{h.stepCalls++;throw Error("secret db credentials");}}));
// The boundary imports domain error types but never their database clients.
vi.mock("@/lib/fieldService/serviceJobs",()=>({ServiceJobError:class extends Error{}}));
vi.mock("@/lib/fieldService/complaints",()=>({ComplaintError:class extends Error{}}));
vi.mock("@/lib/fieldService/siteVisits",()=>({SiteVisitError:class extends Error{}}));
import { GET, POST } from "@/app/api/field-service/steps/route";
beforeEach(()=>{vi.spyOn(console,"error").mockImplementation(()=>undefined);h.suspended=false;h.staff=false;h.assigned=true;h.orgs=[];h.stepCalls=0;});
const request=(body:unknown)=>new Request("http://localhost/api/field-service/steps",{method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}});
describe("field service route admission",()=>{
 it("rejects suspended org for assignee reads",async()=>{h.suspended=true;expect((await GET(new Request("http://localhost/api/field-service/steps?taskType=SERVICE&taskId=t"))).status).toBe(403);expect(h.orgs).toEqual(["org-a"]);});
 it("rejects malformed exact history cycle",async()=>{h.staff=true;expect((await GET(new Request("http://localhost/api/field-service/steps?taskType=SERVICE&taskId=t&cycle=1x"))).status).toBe(400);});
 it("rejects future history cycles",async()=>{h.staff=true;expect((await GET(new Request("http://localhost/api/field-service/steps?taskType=SERVICE&taskId=t&cycle=3"))).status).toBe(400);});
 it("denies unassigned reads",async()=>{h.assigned=false;expect((await GET(new Request("http://localhost/api/field-service/steps?taskType=SERVICE&taskId=t"))).status).toBe(403);});
 it("requires exact cycle on writes",async()=>{expect((await POST(request({taskType:"SERVICE",taskId:"t",step:1,sitePhotoUrl:"/uploads/orgs/org-a/ATT-123-x.jpg",latitude:0,longitude:0}))).status).toBe(400);expect(h.stepCalls).toBe(0);});
 it("hides unexpected backend errors",async()=>{const res=await POST(request({taskType:"SERVICE",taskId:"t",step:1,cycle:2,sitePhotoUrl:"/uploads/orgs/org-a/ATT-123-x.jpg",latitude:0,longitude:0}));expect(res.status).toBe(500);expect(JSON.stringify(await res.json())).not.toContain("credentials");});
});
