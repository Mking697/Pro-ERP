import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => {
  class Conflict extends Error { status = 409; }
  class Input extends Error { status = 400; }
  class Order extends Error {}
  return { payment: vi.fn(async () => ({ id: "ORD" })), guard: vi.fn(async () => ({ok:true,session:{userId:"trusted-actor"}})),
    key: vi.fn((request: Request) => request.headers.get("Idempotency-Key") ?? undefined), Conflict, Input, Order };
});
vi.mock("@/lib/auth/guard", () => ({ requireModule: h.guard }));
vi.mock("@/lib/orders/orders", () => ({ recordPayment: h.payment, OrderError: h.Order }));
vi.mock("@/lib/mutations", () => ({ getMutationKey: h.key, MutationConflictError: h.Conflict, MutationInputError: h.Input }));
import { POST } from "@/app/api/orders/[orderId]/payment/route";
function request(body: unknown = {amount:"10",mode:"Cash",reference:" ref ",actorId:"forged"}, key = "request-key") {
  return new Request("https://example.invalid/api/orders/ORD/payment", { method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(body) });
}
const context = { params: Promise.resolve({orderId:"ORD"}) };
beforeEach(() => vi.clearAllMocks());
it("confirmed payment commit is returned as success rather than a retryable failure", async () => {
  h.payment.mockRejectedValueOnce(Object.assign(new Error("cleanup failed"), {committed:true,result:{id:"ORD"}}));
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({order:{id:"ORD"},committed:true});
});
it("payment API returns 409 for a mismatched durable request key", async () => {
  h.payment.mockRejectedValueOnce(new h.Conflict("binding conflict"));
  const response = await POST(request(), context);
  expect(response.status).toBe(409);
});
it("payment API forwards request identity with parsed input and authenticated actor", async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  expect(h.payment).toHaveBeenCalledExactlyOnceWith("ORD", {amount:10,mode:"Cash",reference:"ref"}, "trusted-actor", "request-key");
});
