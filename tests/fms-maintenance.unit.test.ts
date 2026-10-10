/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic SQL AST interpreter and heterogeneous in-memory persistence fixtures; application code remains fully typed. */
import { beforeEach, expect, it, vi } from "vitest";
type Row = Record<string, any>;
const s = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, locked: false, fault: "", readsUnlocked: [] as string[], raceRunWrite: false, raceRequestWrite: false, runWrites: [] as string[] }));
vi.mock("@/db/client", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const active = new AsyncLocalStorage<boolean>();
  let queue = Promise.resolve();
  const { getTableName } = await import("drizzle-orm");
  const evaluate = (node: any, row: Row): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], row) === evaluate(chunks[3], row);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, row));
      if (text === "()") return evaluate(chunks[1], row);
      if (chunks.length === 1) return evaluate(chunks[0], row);
    }
    if (node?.table && node?.name) return row[node.name];
    if (node && "value" in node) return node.value;
    return node;
  };
  const domainRow = (row: Row) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/[A-Z]/g, m => "_"+m.toLowerCase()), v]));
  const query = (table: any, operation: string, fields?: Row, projection?: Row) => {
    const name = getTableName(table); let predicate: any;
    const builder: any = {
      where(p: any) { predicate=p; return builder; },
      returning(p?: Row) { projection=p; return builder; },
      async then(resolve: any, reject: any) {
        try {
          if (!active.getStore()) s.readsUnlocked.push(name);
          if (s.fault === operation+":"+name) throw new Error("injected "+s.fault);
          if(operation === "update" && name === "fms_runs" && s.raceRunWrite) s.rows[name][0].status="On Time";
          if(operation === "update" && name === "maintenance_requests" && s.raceRequestWrite) s.rows[name][0].status="Resolved";
          const matched = s.rows[name].filter(row => !predicate || evaluate(predicate,domainRow(row)));
          if(operation === "update") matched.forEach(row => { if(name === "fms_runs") s.runWrites.push(fields!.status); Object.assign(row,fields); });
          if(operation === "delete") s.rows[name]=s.rows[name].filter(row => !matched.includes(row));
          resolve(matched.map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key,col]:any) => [key,domainRow(row)[col.name]])) : structuredClone(row)));
        } catch(e) { reject(e); }
      }
    }; return builder;
  };
  return {
    db: {
      select: (projection?: Row) => ({ from: (table: any) => query(table,"select",undefined,projection) }),
      delete: (table: any) => query(table,"delete"),
      update: (table: any) => ({ set: (fields: Row) => query(table,"update",fields) }),
    },
    async runInTenantTransaction(_org: string, work: () => Promise<any>) {
      if(active.getStore()) return work();
      const previous=queue; let release!:()=>void;
      queue=new Promise<void>(r => release=r); await previous;
      const snapshot=structuredClone(s.rows);
      try { return await active.run(true,work); }
      catch(e) { s.rows=snapshot; throw e; }
      finally { release(); }
    },
    isInTenantTransaction: () => !!active.getStore(),
  };
});
vi.mock("@/db/repo", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { isInTenantTransaction } = await import("@/db/client");
  const check=(table:any,op:string) => {
    const name=getTableName(table);
    if(!isInTenantTransaction()) s.readsUnlocked.push(name);
    if(s.fault===op+":"+name) throw new Error("injected "+s.fault);
    return name;
  };
  return {
    findById: async (table:any,org:string,id:string) => structuredClone(s.rows[check(table,"select")].find(r=>r.orgId===org && r.id===id)),
    listByOrg: async (table:any,org:string) => s.rows[check(table,"select")].filter(r=>r.orgId===org),
    insertRecord: async (table:any,row:Row) => {
      const name=check(table,"insert");
      const result={ productionLineRunId:"",productionLineTemplateName:"",assignedTo:"",fixedBy:"",fixedAt:null,fixedRemark:"",confirmedBy:"",confirmedAt:null,confirmedRemark:"",pausedTatDeadline:null,workingMinutesLost:null,createdAt:new Date(),...row };
      s.rows[name].push(result); return structuredClone(result);
    },
    updateById: async (table:any,org:string,id:string,fields:Row) => {
      const row=s.rows[check(table,"update")].find(r=>r.orgId===org && r.id===id);
      if(row) { if(check(table,"update") === "maintenance_requests" && s.raceRequestWrite) row.status="Resolved"; if(check(table,"update") === "fms_runs") { if(s.raceRunWrite) row.status="On Time"; s.runWrites.push(fields.status); } Object.assign(row,fields); } return structuredClone(row);
    },
  };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/fms/calendar", () => ({ computeWorkingMinutesBetween: async () => 5 }));
import { resetAllFmsData } from "@/lib/fms/reset";
import { reportBreakdown, confirmResolved, cancelRequest, assignMaintenanceRequest, markFixedByMaintenance, reopenRequest, createStandaloneRequest, closeStandaloneRequest } from "@/lib/maintenance/maintenance";
it.each(["assign", "fix", "reopen", "create", "close"])("%s keeps request and activity atomic", async (command) => {
  const request=await createStandaloneRequest({kind:"Other",reportedBy:"user",description:"work"});
  if(command === "reopen") s.rows.maintenance_requests[0].status="Fixed_By_Maintenance";
  const before=structuredClone(s.rows); s.readsUnlocked=[]; s.fault="insert:maintenance_activities";
  const work=command === "assign" ? assignMaintenanceRequest(request.id,"worker","user") : command === "fix" ? markFixedByMaintenance({requestId:request.id,fixedBy:"worker"}) : command === "reopen" ? reopenRequest({requestId:request.id,actorId:"user"}) : command === "create" ? createStandaloneRequest({kind:"Other",reportedBy:"user",description:"new"}) : closeStandaloneRequest({requestId:request.id,actorId:"worker"});
  await expect(work).rejects.toThrow("injected"); expect(s.rows).toEqual(before); expect(s.readsUnlocked).toEqual([]);
});
function pendingRun() {
  s.rows.fms_runs.push({id:"run",orgId:"org",status:"Pending",assignedTo:"user",stepName:"Output",templateName:"Line",tatDeadline:new Date("2026-10-10")});
}
it("breakdown activity failure rolls back the pause and request", async () => {
  pendingRun(); s.fault="insert:maintenance_activities";
  await expect(reportBreakdown({runId:"run",reportedBy:"user",description:"broken"})).rejects.toThrow("injected");
  expect(s.rows.fms_runs[0].status).toBe("Pending");
  expect(s.rows.maintenance_requests).toEqual([]);
  expect(s.readsUnlocked).toEqual([]);
});
it("cancel activity failure rolls back the resume and request", async () => {
  pendingRun(); const request=await reportBreakdown({runId:"run",reportedBy:"user",description:"broken"});
  s.fault="insert:maintenance_activities";
  await expect(cancelRequest(request.id,"user")).rejects.toThrow("injected");
  expect(s.rows.fms_runs[0].status).toBe("Paused");
  expect(s.rows.maintenance_requests[0].status).toBe("Open");
  expect(s.rows.maintenance_activities).toHaveLength(1); expect(s.readsUnlocked).toEqual([]);
});
it("resolve activity failure rolls back the deadline, resume and request", async () => {
  pendingRun(); const request=await reportBreakdown({runId:"run",reportedBy:"user",description:"broken"});
  s.rows.maintenance_requests[0].status="Fixed_By_Maintenance";
  const before=structuredClone(s.rows); s.fault="insert:maintenance_activities";
  await expect(confirmResolved({requestId:request.id,actorId:"user"})).rejects.toThrow("injected");
  expect(s.rows).toEqual(before); expect(s.readsUnlocked).toEqual([]);
});
it.each(["report", "cancel", "resolve"])("%s refuses a stale run transition", async (command) => {
  pendingRun();
  let id="";
  if(command !== "report") {
    id=(await reportBreakdown({runId:"run",reportedBy:"user",description:"broken"})).id;
    if(command === "resolve") s.rows.maintenance_requests[0].status="Fixed_By_Maintenance";
  }
  s.raceRunWrite=true; s.runWrites=[];
  const work=command === "report" ? reportBreakdown({runId:"run",reportedBy:"user",description:"broken"}) : command === "cancel" ? cancelRequest(id,"user") : confirmResolved({requestId:id,actorId:"user"});
  await expect(work).rejects.toThrow(/changed/i); expect(s.runWrites).toEqual([]);
});
it("cancellation rejects a stale terminal request transition", async () => {
  const request=await createStandaloneRequest({kind:"Other",reportedBy:"user",description:"work"});
  s.raceRequestWrite=true;
  await expect(cancelRequest(request.id,"user")).rejects.toThrow(/changed/i);
});
beforeEach(() => {
  s.rows=Object.fromEntries(["fms_templates","fms_runs","production_plans","maintenance_requests","maintenance_activities"].map(n=>[n,[]]));
  s.fault=""; s.readsUnlocked=[]; s.raceRunWrite=false; s.raceRequestWrite=false; s.runWrites=[];
});
it("reset refuses to erase production-linked completed history", async () => {
  s.rows.fms_runs=[{ id:"run",orgId:"org",contextRef:"PRODUCTION_PLANS:plan",status:"On Time" }];
  s.rows.fms_templates=[{ templateId:"line",orgId:"org" }];
  const before=structuredClone(s.rows);
  await expect(resetAllFmsData()).rejects.toThrow(/production/i);
  expect(s.rows).toEqual(before); expect(s.readsUnlocked).toEqual([]);
});
