import { beforeEach, expect, it, vi } from "vitest";

// R7: a foundation AggregateError{committed:true, result} means the mutation's own
// transaction committed successfully but post-commit connection cleanup failed
// afterwards (db/client.ts). Every API route that owns a tenant mutation must surface
// that committed result as a safe warning, not a generic 400 that invites a blind retry.
const h = vi.hoisted(() => {
  class Conflict extends Error { status = 409; }
  class Input extends Error { status = 400; }
  class LedgerConflict extends Error { status = 409; }
  class LedgerErr extends Error {}
  class DebitNoteErr extends Error {}
  class PayablesErr extends Error {}
  class PlanErr extends Error {}
  class InsufficientStock extends Error {}
  class InsufficientAvailable extends Error {}
  return {
    Conflict, Input, LedgerConflict, LedgerErr, DebitNoteErr, PayablesErr, PlanErr,
    InsufficientStock, InsufficientAvailable,
    guard: vi.fn(async () => ({ ok: true, session: { userId: "actor-1", email: "actor@test.invalid" } })),
    key: vi.fn((request: Request) => request.headers.get("Idempotency-Key") ?? undefined),
    runIdempotent: vi.fn(async (_orgId: string, _options: unknown, work: () => Promise<unknown>) => work()),
    getOrgId: vi.fn(async () => "org-1"),
    applyDebitNoteToBill: vi.fn(async () => ({ id: "DN1" })),
    receiveDebitNotePayment: vi.fn(async () => ({ id: "DN1" })),
    createManualJournalEntry: vi.fn(async () => "JE1"),
    recordBillPayment: vi.fn(async () => ({ id: "BILL1" })),
    startFmsInstance: vi.fn(async () => ({ id: "RUN1" })),
    completeFmsStep: vi.fn(async () => ({ id: "RUN1" })),
    startProduction: vi.fn(async () => ({ id: "PLAN1" })),
    completePlan: vi.fn(async () => ({ id: "PLAN1" })),
    cancelPlan: vi.fn(async () => ({ id: "PLAN1" })),
    reallocatePlan: vi.fn(async () => ({ id: "PLAN1" })),
    recordMovement: vi.fn(async () => ({ id: "MOV1" })),
    findItem: vi.fn(async () => ({ SKU: "SKU1", UOM: "pcs", Location: "A1" })),
  };
});

vi.mock("@/lib/auth/guard", () => ({ requireModule: h.guard, requireSession: h.guard }));
vi.mock("@/lib/mutations", () => ({
  getMutationKey: h.key,
  runIdempotentTenantMutation: h.runIdempotent,
  MutationConflictError: h.Conflict,
  MutationInputError: h.Input,
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: h.getOrgId }));
vi.mock("@/lib/accounts/ledger", () => ({
  LedgerConflictError: h.LedgerConflict,
  LedgerError: h.LedgerErr,
  createManualJournalEntry: h.createManualJournalEntry,
  InsufficientStockError: h.InsufficientStock,
}));
vi.mock("@/lib/accounts/debitNotes", () => ({
  applyDebitNoteToBill: h.applyDebitNoteToBill,
  receiveDebitNotePayment: h.receiveDebitNotePayment,
  DebitNoteError: h.DebitNoteErr,
}));
vi.mock("@/lib/accounts/payables", () => ({
  recordBillPayment: h.recordBillPayment,
  PayablesError: h.PayablesErr,
}));
vi.mock("@/lib/fms/engine", () => ({
  startFmsInstance: h.startFmsInstance,
  completeFmsStep: h.completeFmsStep,
}));
vi.mock("@/lib/inventory/plans", () => ({
  startProduction: h.startProduction,
  completePlan: h.completePlan,
  cancelPlan: h.cancelPlan,
  reallocatePlan: h.reallocatePlan,
  PlanError: h.PlanErr,
}));
vi.mock("@/lib/inventory/ledger", () => ({
  recordMovement: h.recordMovement,
  InsufficientStockError: h.InsufficientStock,
  DIRECTIONS: ["In", "Out"],
}));
vi.mock("@/lib/inventory/items", () => ({ findItem: h.findItem }));
vi.mock("@/lib/inventory/availability", () => ({ InsufficientAvailableStockError: h.InsufficientAvailable }));

import { POST as debitNoteApply } from "@/app/api/accounts/debit-notes/[debitNoteId]/apply/route";
import { POST as debitNoteReceive } from "@/app/api/accounts/debit-notes/[debitNoteId]/receive/route";
import { POST as journalEntry } from "@/app/api/accounts/ledger/journal-entries/route";
import { POST as billPayment } from "@/app/api/accounts/bills/[billId]/payments/route";
import { POST as fmsStart } from "@/app/api/fms/instances/route";
import { POST as fmsComplete } from "@/app/api/fms/steps/[runId]/complete/route";
import { PATCH as ppcPatch } from "@/app/api/ppc/plans/[planId]/route";
import { POST as movementPost } from "@/app/api/inventory/movements/route";

beforeEach(() => vi.clearAllMocks());

function jsonRequest(url: string, body: unknown, key = "k1") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}
function committedError(result: unknown) {
  return Object.assign(new Error("cleanup failed"), { committed: true, result });
}

it("debit-note apply returns the committed result instead of a retryable 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError({ id: "DN1" }));
  const response = await debitNoteApply(
    jsonRequest("https://x.invalid/api/accounts/debit-notes/DN1/apply", { billId: "B1", amount: 10 }),
    { params: Promise.resolve({ debitNoteId: "DN1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ debitNote: { id: "DN1" }, committed: true });
});

it("debit-note receive returns the committed result instead of a retryable 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError({ id: "DN1" }));
  const response = await debitNoteReceive(
    jsonRequest("https://x.invalid/api/accounts/debit-notes/DN1/receive", { amount: 10 }),
    { params: Promise.resolve({ debitNoteId: "DN1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ debitNote: { id: "DN1" }, committed: true });
});

it("manual journal entry returns the committed id instead of a retryable 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError("JE1"));
  const response = await journalEntry(
    jsonRequest("https://x.invalid/api/accounts/ledger/journal-entries", {
      description: "Adj", lines: [{ accountId: "A1", debit: 10 }, { accountId: "A2", credit: 10 }],
    })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: "JE1", committed: true });
});

it("bill payment returns the committed result instead of a retryable 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError({ id: "BILL1" }));
  const response = await billPayment(
    jsonRequest("https://x.invalid/api/accounts/bills/BILL1/payments", { amount: 10, mode: "Cash" }),
    { params: Promise.resolve({ billId: "BILL1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ bill: { id: "BILL1" }, committed: true });
});

it("FMS instance start returns the committed result instead of a retryable 400", async () => {
  h.startFmsInstance.mockRejectedValueOnce(committedError({ id: "RUN1" }));
  const response = await fmsStart(
    jsonRequest("https://x.invalid/api/fms/instances", { templateId: "T1" })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ run: { id: "RUN1" }, committed: true });
});

it("FMS step completion returns the committed result instead of a retryable 400", async () => {
  h.completeFmsStep.mockRejectedValueOnce(committedError({ run: { id: "RUN1" } }));
  const response = await fmsComplete(
    jsonRequest("https://x.invalid/api/fms/steps/RUN1/complete", { outcome: "Done" }),
    { params: Promise.resolve({ runId: "RUN1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ run: { id: "RUN1" }, committed: true });
});

it("PPC plan PATCH returns the committed result instead of a retryable 400", async () => {
  h.completePlan.mockRejectedValueOnce(committedError({ id: "PLAN1" }));
  const response = await ppcPatch(
    jsonRequest("https://x.invalid/api/ppc/plans/PLAN1", { action: "complete" }),
    { params: Promise.resolve({ planId: "PLAN1" }) }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ plan: { id: "PLAN1" }, committed: true });
});

it("manual inventory movement returns the committed result instead of a retryable 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError({ id: "MOV1" }));
  const response = await movementPost(
    jsonRequest("https://x.invalid/api/inventory/movements", {
      sku: "SKU1", direction: "In", quantity: 5,
    })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ movement: { id: "MOV1" }, committed: true });
});
