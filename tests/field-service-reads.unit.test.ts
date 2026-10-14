import { expect, it, vi } from "vitest";
const h=vi.hoisted(()=>({queries:0}));
vi.mock("@/db/client",()=>({db:{select:()=>({from:()=>({where:async()=>{h.queries++;return [{id:"c",customerName:"Customer"}];}})})}}));
vi.mock("@/lib/fieldService/assignments",()=>({attachAssignments:async()=>new Map([["t1",[]],["t2",[]]])}));
vi.mock("@/lib/fieldService/steps",()=>({attachSteps:async()=>new Map([["t1",null],["t2",null]])}));
import { getBatchDetails } from "@/lib/fieldService/reads";
it("hydrates multiple tasks with one customer query and batched dependencies",async()=>{const result=await getBatchDetails("org-a","SERVICE",[{id:"t1",currentCycle:1,customerId:"c"},{id:"t2",currentCycle:2,customerId:"c"}]);expect(h.queries).toBe(1);expect(result.customers.get("c")?.customerName).toBe("Customer");expect(result.assignments.size).toBe(2);});
