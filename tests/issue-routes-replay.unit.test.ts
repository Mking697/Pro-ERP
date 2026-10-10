import { beforeEach, expect, it, vi } from "vitest";

// Second-phase gap B: bill-issue / invoice-issue routes had only domain-level guarded
// idempotence (already-Issued -> 400), not durable keyed replay. This mirrors item5's
// own unit test shape (tests/replay-recovery-api.unit.test.ts) for the same committed:true
// contract, applied to the two issue routes that item5 left unwrapped.
const h = vi.hoisted(() => {
  class Conflict extends Error { status = 409; }
  class Input extends Error { status = 400; }
  class PayablesErr extends Error {}
  class AccountsErr extends Error {}
  return {
    Conflict, Input, PayablesErr, AccountsErr,
    guard: vi.fn(async () => ({ ok: true, session: { userId: "actor-1", email: "actor@test.invalid" } })),
    key: vi.fn((request: Request) => request.headers.get("Idempotency-Key") ?? undefined),
    runIdempotent: vi.fn(async (_orgId: string, _options: unknown, work: () => Promise<unknown>) => work()),
    getOrgId: vi.fn(async () => "org-1"),
    issueBill: vi.fn(async () => ({ id: "BILL1", status: "Issued" })),
    issueInvoice: vi.fn(async () => ({ id: "INV1", status: "Issued" })),
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
vi.mock("@/lib/accounts/payables", () => ({ issueBill: h.issueBill, PayablesError: h.PayablesErr }));
vi.mock("@/lib/accounts/accounts", () => ({ issueInvoice: h.issueInvoice, AccountsError: h.AccountsErr }));

import { POST as billIssue } from "@/app/api/accounts/bills/[billId]/issue/route";
import { POST as invoiceIssue } from "@/app/api/accounts/invoices/[invoiceId]/issue/route";

beforeEach(() => vi.clearAllMocks());

function postRequest(url: string, key = "k1") {
  return new Request(url, {
    method: "POST",
    headers: key ? { "Idempotency-Key": key } : {},
  });
}
function committedError(result: unknown) {
  return Object.assign(new Error("cleanup failed"), { committed: true, result });
}

it("bill issue returns the Issued DTO on first call", async () => {
  const response = await billIssue(postRequest("https://x.invalid/api/accounts/bills/BILL1/issue"), {
    params: Promise.resolve({ billId: "BILL1" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ bill: { id: "BILL1", status: "Issued" } });
});

it("bill issue returns the committed result instead of a retryable 400 on key replay", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError({ id: "BILL1", status: "Issued" }));
  const response = await billIssue(postRequest("https://x.invalid/api/accounts/bills/BILL1/issue"), {
    params: Promise.resolve({ billId: "BILL1" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ bill: { id: "BILL1", status: "Issued" }, committed: true });
});

it("bill issue maps a replayed key with a different payload to 409, not 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(new h.Conflict("Idempotency key is already bound to a different actor, operation or payload"));
  const response = await billIssue(postRequest("https://x.invalid/api/accounts/bills/BILL1/issue"), {
    params: Promise.resolve({ billId: "BILL1" }),
  });
  expect(response.status).toBe(409);
});

it("bill issue without a key still rejects an already-Issued bill via the domain guard (400)", async () => {
  h.runIdempotent.mockImplementationOnce(async (_orgId, _options, work) => work());
  h.issueBill.mockRejectedValueOnce(new h.PayablesErr("Ye bill pehle se Issued hai."));
  const response = await billIssue(postRequest("https://x.invalid/api/accounts/bills/BILL1/issue", ""), {
    params: Promise.resolve({ billId: "BILL1" }),
  });
  expect(response.status).toBe(400);
});

it("invoice issue returns the Issued DTO on first call", async () => {
  const response = await invoiceIssue(postRequest("https://x.invalid/api/accounts/invoices/INV1/issue"), {
    params: Promise.resolve({ invoiceId: "INV1" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ invoice: { id: "INV1", status: "Issued" } });
});

it("invoice issue returns the committed result instead of a retryable 400 on key replay", async () => {
  h.runIdempotent.mockRejectedValueOnce(committedError({ id: "INV1", status: "Issued" }));
  const response = await invoiceIssue(postRequest("https://x.invalid/api/accounts/invoices/INV1/issue"), {
    params: Promise.resolve({ invoiceId: "INV1" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ invoice: { id: "INV1", status: "Issued" }, committed: true });
});

it("invoice issue maps a replayed key with a different payload to 409, not 400", async () => {
  h.runIdempotent.mockRejectedValueOnce(new h.Conflict("Idempotency key is already bound to a different actor, operation or payload"));
  const response = await invoiceIssue(postRequest("https://x.invalid/api/accounts/invoices/INV1/issue"), {
    params: Promise.resolve({ invoiceId: "INV1" }),
  });
  expect(response.status).toBe(409);
});

it("invoice issue without a key still rejects an already-Issued invoice via the domain guard (400)", async () => {
  h.runIdempotent.mockImplementationOnce(async (_orgId, _options, work) => work());
  h.issueInvoice.mockRejectedValueOnce(new h.AccountsErr("Ye invoice pehle se Issued hai."));
  const response = await invoiceIssue(postRequest("https://x.invalid/api/accounts/invoices/INV1/issue", ""), {
    params: Promise.resolve({ invoiceId: "INV1" }),
  });
  expect(response.status).toBe(400);
});
