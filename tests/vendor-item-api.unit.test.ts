import { beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  guard: vi.fn(), findById: vi.fn(), upsert: vi.fn(),
  admissionRows: [] as unknown[][], lookup: 0,
}));
vi.mock("@/lib/auth/guard", () => ({ requireModule: s.guard }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org-a" }));
vi.mock("@/db/repo", () => ({ findById: s.findById }));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({
    limit: async () => s.admissionRows[s.lookup++] ?? [],
  }) }) }) },
  runInTenantTransaction: async (_orgId: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("@/lib/parties/vendorItems", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/parties/vendorItems")>(),
  upsertVendorItem: s.upsert,
}));

import { POST } from "@/app/api/parties/vendors/[vendorId]/items/route";

const record = { Vendor_Item_ID: "VIT-1", SKU: "SKU-1" };
function post(body: Record<string, unknown>) {
  return POST(new Request("http://localhost/api/parties/vendors/VEN-1/items", {
    method: "POST", body: JSON.stringify({ sku: "SKU-1", ...body }),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ vendorId: "VEN-1" }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  s.guard.mockResolvedValue({ ok: true, session: { email: "actor@example.test" } });
  s.findById.mockResolvedValue({ id: "VEN-1" });
  s.upsert.mockResolvedValue(record);
});

it.each([
  ["leadTimeDays", -1], ["leadTimeDays", "-1"],
  ["leadTimeDays", 1.5], ["leadTimeDays", "1.5"],
  ["leadTimeDays", 2147483648], ["leadTimeDays", "2147483648"],
  ["unitPrice", -0.01], ["unitPrice", "-0.01"],
  ["unitPrice", "Infinity"], ["unitPrice", "-Infinity"], ["unitPrice", "1e309"],
])("rejects invalid numeric operand %s=%s without a domain write", async (field, value) => {
  const response = await post({ [field]: value });
  expect(response.status).toBe(400);
  expect(s.upsert).not.toHaveBeenCalled();
});

it.each([
  ["omitted", {}],
  ["empty", { leadTimeDays: "", unitPrice: "  " }],
  ["null", { leadTimeDays: null, unitPrice: null }],
])("accepts %s optional operands as null", async (_name, body) => {
  const response = await post(body);
  expect(response.status).toBe(200);
  expect(s.upsert).toHaveBeenCalledExactlyOnceWith({
    vendorId: "VEN-1", sku: "SKU-1", leadTimeDays: null, unitPrice: null,
    createdBy: "actor@example.test",
  });
});

it.each([
  ["missing vendor", {}, [], 404],
  ["foreign vendor", {}, [], 404],
  ["missing item", {}, [[{ id: "VEN-1" }], []], 404],
  ["foreign item", {}, [[{ id: "VEN-1" }], []], 404],
  ["domain lead time", { leadTimeDays: -1 }, [], 400],
  ["domain price", { unitPrice: -1 }, [], 400],
] as const)("maps typed %s admission rejection to intentional 4xx", async (_name, operands, rows, status) => {
  const domain = await vi.importActual<typeof import("@/lib/parties/vendorItems")>("@/lib/parties/vendorItems");
  s.admissionRows = rows.map((row) => [...row]);
  s.lookup = 0;
  const error = await domain.upsertVendorItem({
    vendorId: "VEN-1", sku: "SKU-1", createdBy: "actor", ...operands,
  }).catch((error: unknown) => error);
  expect(error).toMatchObject({ name: "VendorItemAdmissionError", status });
  s.upsert.mockRejectedValueOnce(error);
  const response = await post({});
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: (error as Error).message });
  expect(s.upsert).toHaveBeenCalledTimes(1);
});

it("reports a confirmed commit with its result and warning without retry", async () => {
  const error = Object.assign(new Error("cleanup failed"), { committed: true, result: record });
  s.upsert.mockRejectedValueOnce(error);
  const response = await post({});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ item: record, committed: true, warning: "cleanup failed" });
  expect(s.upsert).toHaveBeenCalledTimes(1);
});

it.each([
  ["numeric strings", " 3 ", "12.50", 3, 12.5],
  ["numeric zero", 0, 0, 0, 0],
  ["string zero", "0", "0", 0, 0],
  ["database maximum", "2147483647", "0.125", 2147483647, 0.125],
] as const)("accepts %s without changing numeric meaning", async (_name, leadTimeDays, unitPrice, lead, price) => {
  const response = await post({ sku: " SKU-1 ", leadTimeDays, unitPrice });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ item: record });
  expect(s.upsert).toHaveBeenCalledExactlyOnceWith({
    vendorId: "VEN-1", sku: "SKU-1", leadTimeDays: lead, unitPrice: price,
    createdBy: "actor@example.test",
  });
});

it.each([
  new Error("database offline"), new Error("Item nahi mila."),
  Object.assign(new Error("Vendor nahi mila."), { name: "VendorItemAdmissionError", status: 404 }),
  Object.assign(new Error("not confirmed"), { committed: false, result: record }),
  Object.assign(new Error("missing result"), { committed: true }),
])("does not misclassify unknown failure %# as a client rejection or success", async (error) => {
  s.upsert.mockRejectedValueOnce(error);
  await expect(post({})).rejects.toBe(error);
  expect(s.upsert).toHaveBeenCalledTimes(1);
});

it("preserves the vendor preflight 404 without a domain write", async () => {
  s.findById.mockResolvedValueOnce(null);
  const response = await post({});
  expect(response.status).toBe(404);
  expect(s.upsert).not.toHaveBeenCalled();
});

it("returns the authorization response without lookup or write", async () => {
  const denied = Response.json({ error: "forbidden" }, { status: 403 });
  s.guard.mockResolvedValueOnce({ ok: false, response: denied });
  expect(await post({})).toBe(denied);
  expect(s.findById).not.toHaveBeenCalled();
  expect(s.upsert).not.toHaveBeenCalled();
});

it.each(["leadTimeDays", "unitPrice"])("rejects malformed numeric text in %s without a domain write", async (field) => {
  const response = await post({ [field]: "not-a-number" });
  expect(response.status).toBe(400);
  expect(s.upsert).not.toHaveBeenCalled();
});
