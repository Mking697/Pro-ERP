import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), tenant: vi.fn(), catalog: vi.fn(), list: vi.fn(), get: vi.fn(), preview: vi.fn(), create: vi.fn(), update: vi.fn(), finalize: vi.fn(), approve: vi.fn() }));
vi.mock("@/db/client", () => ({ db: new Proxy({}, { get() { throw new Error("Unexpected database access in HTTP unit test"); } }) }));
vi.mock("@/lib/auth/guard", () => ({ requireModule: m.guard }));
vi.mock("@/lib/tenant", () => ({ runWithTenant: m.tenant }));
vi.mock("@/lib/costing/service", () => ({ getCostCatalog:m.catalog,listCostSheets:m.list,getProductCostSheet:m.get,previewCostSheet:m.preview,costingService:{create:m.create,update:m.update,finalize:m.finalize,approveStandard:m.approve} }));
import { GET, POST } from "@/app/api/cost-sheets/route";
import { GET as catalog } from "@/app/api/cost-sheets/catalog/route";
import { POST as preview } from "@/app/api/cost-sheets/preview/route";
import { GET as detail, PATCH } from "@/app/api/cost-sheets/[id]/route";
import { POST as finalize } from "@/app/api/cost-sheets/[id]/finalize/route";
import { POST as approve } from "@/app/api/cost-sheets/standard-rates/route";
import { GET as exportSheet } from "@/app/api/cost-sheets/[id]/export/route";
import { CostingError } from "@/lib/costing/validation";
import { input, facts } from "./costing-fixtures";
import { calculateCostSheet } from "@/lib/costing/engine";
const context = { params: Promise.resolve({id:"s1"}) };
function request(body: unknown = {input}, key: string | null = "k1") { return new Request("http://localhost/api/cost-sheets",{method:"POST",headers:{"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify(body)}); }
beforeEach(() => {
 vi.resetAllMocks(); m.guard.mockResolvedValue({ok:true,session:{userId:"U"},tenant:{orgId:"A"}}); m.tenant.mockImplementation((_t,work)=>work());
});
const reads = () => [GET(new Request("http://localhost/api/cost-sheets?productSku=FG")), catalog(),detail(request(),context),exportSheet(request(),context)];
const writes = () => [POST(request()),preview(request(input)),PATCH(request({input,expectedVersion:1}),context),finalize(request({expectedVersion:1}),context),approve(request({}))];
describe("costing HTTP boundary", () => {
 it.each([401,403])("denies all endpoints with %s before service/tenant work", async status => {
  m.guard.mockResolvedValue({ok:false,response:Response.json({error:"Denied"},{status})});
  for(const result of await Promise.all([...reads(),...writes()])) expect(result.status).toBe(status);
  expect(m.tenant).not.toHaveBeenCalled(); expect(m.get).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
 });
 it("runs reads and mutations in the validated tenant and preserves exact SKU and version",async()=>{
  m.list.mockResolvedValue([]);m.catalog.mockResolvedValue([]);m.get.mockResolvedValue({id:"s1"});m.preview.mockResolvedValue({complete:false});m.create.mockResolvedValue({id:"s1"});m.update.mockResolvedValue({id:"s1"});m.finalize.mockResolvedValue({id:"s1"});m.approve.mockResolvedValue({id:"r"});
  expect((await GET(new Request("http://localhost/api/cost-sheets?productSku=FG%2F%20%26"))).status).toBe(200); expect(m.list).toHaveBeenCalledWith("FG/ &");
  await POST(request());await PATCH(request({input,expectedVersion:1}),context);await finalize(request({expectedVersion:1}),context);
  expect(m.create).toHaveBeenCalledWith({input},"k1");expect(m.update).toHaveBeenCalledWith("s1",{input,expectedVersion:1},"k1");expect(m.finalize).toHaveBeenCalledWith("s1",{expectedVersion:1},"k1");
  for(const call of m.tenant.mock.calls) expect(call[0]).toEqual({orgId:"A"});
 });
 it("rejects missing idempotency and malformed JSON without writes",async()=>{
  expect((await POST(request({input},null))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/cost-sheets",{method:"POST",headers:{"Idempotency-Key":"k"},body:"{"}))).status).toBe(400);
  expect(m.create).not.toHaveBeenCalled();
 });
 it("returns domain conflicts/not-found and never exposes raw database errors",async()=>{
  m.create.mockRejectedValue(new CostingError("Reload stale version",409));expect((await POST(request())).status).toBe(409);
  m.get.mockResolvedValue(null);expect((await detail(request(),context)).status).toBe(404);
  m.create.mockRejectedValue(new Error("secret SQL postgres credential"));const response=await POST(request());expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain("secret");
 });
 it("exports the immutable saved snapshot with text cells, not formulas or live recalculation",async()=>{
  const calculation=calculateCostSheet(input,facts);calculation.productName="=HYPERLINK(\"bad\")";m.get.mockResolvedValue({id:"s1",productSku:"FG/evil",productName:calculation.productName,revision:1,status:"Finalized",version:2,calculation,createdAt:"2026-10-23",createdBy:"U",finalizedAt:"2026-10-23",finalizedBy:"U"});
  const response=await exportSheet(request(),context);expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toContain("no-store");expect(response.headers.get("Content-Disposition")).not.toContain("FG/evil");
  const {default:ExcelJS}=await import("exceljs");const book=new ExcelJS.Workbook();await book.xlsx.load(await response.arrayBuffer());
  const values:unknown[]=[];book.eachSheet(s=>s.eachRow(r=>r.eachCell(c=>values.push(c.value))));expect(values).toContain(calculation.productName);expect(values.some(v=>typeof v==="object"&&v!==null&&"formula" in v)).toBe(false);expect(m.preview).not.toHaveBeenCalled();
 });
});
