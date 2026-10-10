import { beforeEach, expect, it, vi } from "vitest";

// Second-phase gap C: PPC plan cancel/recheck actions must thread a durable
// Idempotency-Key through to cancelPlan()/reallocatePlan(), mirroring the
// already-approved start/complete wiring in the same route file. Before this
// fix the route called cancelPlan(planId)/reallocatePlan(planId) with no key
// at all, so a client retry after a dropped response could run the mutation
// twice with no replay protection.
const h = vi.hoisted(() => {
  class PlanErr extends Error {}
  class InsufficientStock extends Error {}
  class Conflict extends Error { status = 409; }
  return {
    PlanErr,
    InsufficientStock,
    Conflict,
    guard: vi.fn(async () => ({ ok: true, session: { userId: "actor-1", email: "actor@test.invalid" } })),
    key: vi.fn((request: Request) => request.headers.get("Idempotency-Key") ?? undefined),
    cancelPlan: vi.fn(async () => ({ id: "PLAN1", status: "Cancelled" })),
    reallocatePlan: vi.fn(async () => ({ id: "PLAN1", status: "Ready" })),
    startProduction: vi.fn(async () => ({ id: "PLAN1" })),
    completePlan: vi.fn(async () => ({ id: "PLAN1" })),
  };
});

vi.mock("@/lib/auth/guard", () => ({ requireModule: h.guard, requireSession: h.guard }));
vi.mock("@/lib/mutations", () => ({
  getMutationKey: h.key,
  runIdempotentTenantMutation: vi.fn(async (_orgId: string, _options: unknown, work: () => Promise<unknown>) => work()),
  MutationConflictError: h.Conflict,
}));
vi.mock("@/lib/inventory/plans", () => ({
  startProduction: h.startProduction,
  completePlan: h.completePlan,
  cancelPlan: h.cancelPlan,
  reallocatePlan: h.reallocatePlan,
  PlanError: h.PlanErr,
}));
vi.mock("@/lib/inventory/ledger", () => ({ InsufficientStockError: h.InsufficientStock }));

import { PATCH } from "@/app/api/ppc/plans/[planId]/route";

beforeEach(() => vi.clearAllMocks());

function patchRequest(body: unknown, key = "idem-key-1") {
  return new Request("https://x.invalid/api/ppc/plans/PLAN1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}
function committedError(result: unknown) {
  return Object.assign(new Error("cleanup failed"), { committed: true, result });
}

it("cancel action threads the actor and idempotency key into cancelPlan", async () => {
  const response = await PATCH(
    patchRequest({ action: "cancel" }, "cancel-key-1"),
    { params: Promise.resolve({ planId: "PLAN1" }) }
  );
  expect(response.status).toBe(200);
  expect(h.cancelPlan).toHaveBeenCalledWith("PLAN1", "actor@test.invalid", "cancel-key-1");
});

it("recheck action threads the actor and idempotency key into reallocatePlan", async () => {
  const response = await PATCH(
    patchRequest({ action: "recheck" }, "recheck-key-1"),
    { params: Promise.resolve({ planId: "PLAN1" }) }
  );
  expect(response.status).toBe(200);
  expect(h.reallocatePlan).toHaveBeenCalledWith("PLAN1", "actor@test.invalid", "recheck-key-1");
});

it("cancel replay surfaces the committed result as a 200 warning, not a retryable 400", async () => {
  h.cancelPlan.mockRejectedValueOnce(committedError({ id: "PLAN1", status: "Cancelled" }));
  const response = await PATCH(
    patchRequest({ action: "cancel" }),
    { params: Promise.resolve({ planId: "PLAN1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ plan: { id: "PLAN1" }, committed: true });
});

it("recheck replay surfaces the committed result as a 200 warning, not a retryable 400", async () => {
  h.reallocatePlan.mockRejectedValueOnce(committedError({ id: "PLAN1", status: "Ready" }));
  const response = await PATCH(
    patchRequest({ action: "recheck" }),
    { params: Promise.resolve({ planId: "PLAN1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ plan: { id: "PLAN1" }, committed: true });
});
