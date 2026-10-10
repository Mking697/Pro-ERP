import { beforeEach, expect, it, vi } from "vitest";

// Gap A (second-phase item A): bulk opening-stock item import has no idempotency key at
// all today — createItemsBulk()+recordMovementsBulk() just run plainly. This proves the
// ROUTE wires the whole import (items + opening-stock movements) as ONE
// runIdempotentTenantMutation call, keyed by getMutationKey(request), with the full
// validated row array as the payload — not that mutations.ts's own replay/409 logic
// works (that is already covered end-to-end against real Postgres by
// tests/mutation-idempotency.test.ts and is NOT re-tested here).
//
// The fake below reimplements only the observable contract runIdempotentTenantMutation
// promises (replay an identical key+payload without calling work() again; reject a
// reused key bound to a different payload with a 409-shaped error) so the test stays
// DB-free while still exercising real replay semantics end-to-end through the route.
const h = vi.hoisted(() => {
  class MutationConflictError extends Error {
    status = 409;
    code = "MUTATION_CONFLICT";
  }
  const receipts = new Map<string, { hash: string; result: unknown }>();
  const runIdempotentTenantMutation = vi.fn(
    async (_orgId: string, options: { key?: string; payload: unknown }, work: () => Promise<unknown>) => {
      const { key, payload } = options;
      if (key === undefined) return work();
      const hash = JSON.stringify(payload);
      const existing = receipts.get(key);
      if (existing) {
        if (existing.hash !== hash) throw new MutationConflictError("Idempotency key bound to a different payload");
        return existing.result;
      }
      const result = await work();
      receipts.set(key, { hash, result });
      return result;
    }
  );
  return {
    MutationConflictError,
    receipts,
    runIdempotentTenantMutation,
    getMutationKey: vi.fn((request: Request) => request.headers.get("Idempotency-Key") ?? undefined),
    getTenantOrgId: vi.fn(async () => "org-1"),
    guard: vi.fn(async () => ({ ok: true, session: { userId: "actor-1", email: "actor@test.invalid" } })),
    parseItemsFile: vi.fn(),
    createItemsBulk: vi.fn(),
    recordMovementsBulk: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/auth/guard", () => ({ requireModule: h.guard }));
vi.mock("@/lib/mutations", () => ({
  getMutationKey: h.getMutationKey,
  runIdempotentTenantMutation: h.runIdempotentTenantMutation,
  MutationConflictError: h.MutationConflictError,
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: h.getTenantOrgId }));
vi.mock("@/lib/inventory/itemsImport", () => ({ parseItemsFile: h.parseItemsFile }));
vi.mock("@/lib/inventory/items", () => ({
  createItemsBulk: h.createItemsBulk,
  ITEM_CATEGORIES: ["RM", "FG", "Packaging"],
}));
vi.mock("@/lib/inventory/ledger", () => ({ recordMovementsBulk: h.recordMovementsBulk }));

import { POST } from "@/app/api/inventory/items/import/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.receipts.clear();
});

function importRequest(fileText: string, key = "import-1") {
  const formData = new FormData();
  formData.set("file", new File([fileText], "items.csv", { type: "text/csv" }));
  return new Request("https://x.invalid/api/inventory/items/import", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: formData,
  });
}

function rowsOf(skus: string[]) {
  return skus.map((sku, i) => ({ row: i + 2, sku, itemName: `Item ${sku}`, category: "RM", uom: "pcs", openingStock: 10 }));
}

it("replays the same committed result for a retried import without creating items twice", async () => {
  const rows = rowsOf(["SKU-A", "SKU-B"]);
  h.parseItemsFile.mockResolvedValue({ rows });
  h.createItemsBulk.mockResolvedValue({
    created: rows.map((r) => ({ row: r.row, item: { SKU: r.sku, UOM: "pcs", Location: "" } })),
    errors: [],
  });

  const first = await POST(importRequest("sku,itemName\nSKU-A,Item A\nSKU-B,Item B"));
  const second = await POST(importRequest("sku,itemName\nSKU-A,Item A\nSKU-B,Item B"));

  expect(first.status).toBe(200);
  expect(await first.json()).toEqual(await second.json());
  // The whole import (rows + opening-stock movements) must run inside ONE idempotent
  // call, not be left unwrapped — so a retried request must not re-run either write.
  expect(h.createItemsBulk).toHaveBeenCalledTimes(1);
  expect(h.recordMovementsBulk).toHaveBeenCalledTimes(1);
  expect(h.runIdempotentTenantMutation).toHaveBeenCalledTimes(2);
});

it("rejects a reused idempotency key bound to a different import payload with 409", async () => {
  h.parseItemsFile.mockResolvedValueOnce({ rows: rowsOf(["SKU-A"]) });
  h.createItemsBulk.mockResolvedValueOnce({
    created: [{ row: 2, item: { SKU: "SKU-A", UOM: "pcs", Location: "" } }],
    errors: [],
  });
  const first = await POST(importRequest("sku,itemName\nSKU-A,Item A", "same-key"));
  expect(first.status).toBe(200);

  h.parseItemsFile.mockResolvedValueOnce({ rows: rowsOf(["SKU-C"]) });
  const second = await POST(importRequest("sku,itemName\nSKU-C,Item C", "same-key"));

  expect(second.status).toBe(409);
  // The conflicting second request's own createItemsBulk must never have run.
  expect(h.createItemsBulk).toHaveBeenCalledTimes(1);
});
