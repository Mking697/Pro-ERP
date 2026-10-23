import { describe, expect, it, vi } from "vitest";
import { createJobCostDraftDomain, JobCostStoreError, type JobCostDraftStore } from "@/lib/job-costing/store";
import { calculateJobCost } from "@/lib/job-costing/engine";
import type { JobCostFacts, JobCostInput, JobCostSheet } from "@/lib/job-costing/types";

function input(overrides: Partial<JobCostInput> = {}): JobCostInput {
  return {
    planId: "plan-1", asOfDate: "2026-10-23",
    headDecisions: (["Labour", "DirectExpense", "FactoryOverhead", "Commercial"] as const).map((head) => ({
      head, status: "NotApplicable", reason: "Not required for this job",
    })),
    charges: [], generalDecisions: [], ...overrides,
  };
}

function facts(overrides: Partial<JobCostFacts> = {}): JobCostFacts {
  return {
    orgId: "org-A", capturedAt: "2026-10-23T12:00:00.000Z", capturedBy: "actor-1", sourceFingerprint: "fingerprint-1",
    plan: { planId: "plan-1", jobNo: "JOB-1", productSku: "FG", productName: "Finished product", productUom: "pcs", bomId: "bom-1", bomVersion: "1", status: "Completed", startedAt: "2026-10-22T05:00:00.000Z" },
    materials: [{
      sku: "RM", name: "Raw material", uom: "kg", requiredQty: "999", consumedQty: "2.125", reconciliation: "Reconciled",
      issues: [{ id: "issue-1", timestamp: "2026-10-22T05:00:00.000Z", quantity: "2.125", userId: "issuer" }],
      valuation: { kind: "PurchaseAgreedProvisional", rate: "4.12", uom: "kg", currency: "INR", date: "2026-10-21T05:00:00.000Z", poId: "po-1", lineId: "pol-1", indentId: "ind-1", receiptId: "receipt-1" },
    }],
    output: { reconciliation: "Reconciled", runIds: [], events: [{ id: "output-1", timestamp: "2026-10-23T05:00:00.000Z", quantity: "3", userId: "finisher", sku: "FG", uom: "pcs", referenceId: "plan-1", source: "Production_Output", direction: "In" }] },
    generalSources: [], diagnostics: [], ...overrides,
  };
}

/** Isolated in-memory `JobCostDraftStore` fixture — no DB/HTTP import, mirrors
 * `tests/costing-service.test.ts`'s fixture for the sibling estimated feature. `mutate`
 * commits a receipt (keyed by tenant+key) only once `work()` resolves, which is what gives
 * us the same rollback guarantee as a real `runIdempotentTenantMutation` transaction: a
 * thrown error inside `work()` leaves `rows`/`receipts` exactly as they were before the call. */
function fixture() {
  const rows: (JobCostSheet & { orgId: string })[] = [];
  const receipts = new Map<string, { payload: string; value: unknown }>();
  let allowed = true;
  let tenant = "org-A";
  const factsByPlan = new Map<string, JobCostFacts>([["plan-1", facts()]]);
  let nextIdCounter = 0;

  const store: JobCostDraftStore = {
    authorize: async () => {
      if (!allowed) throw new JobCostStoreError("Forbidden", 403);
      return { orgId: tenant, actorId: "U" };
    },
    mutate: async (actor, operation, key, payload, work) => {
      const hash = JSON.stringify({ actor, operation, payload });
      const receiptKey = actor.orgId + ":" + key;
      const existing = receipts.get(receiptKey);
      if (existing) {
        if (existing.payload !== hash) throw new JobCostStoreError("Idempotency key conflict: different actor/operation/payload", 409);
        return structuredClone(existing.value) as never;
      }
      const result = await work();
      receipts.set(receiptKey, { payload: hash, value: structuredClone(result) });
      return result;
    },
    buildFacts: async ({ orgId, planId }) => {
      const f = factsByPlan.get(planId);
      if (!f || f.orgId !== orgId) throw new JobCostStoreError("Production plan not found for this tenant", 404);
      return structuredClone(f);
    },
    get: async (orgId, id) => {
      const row = rows.find((r) => r.id === id && r.orgId === orgId);
      return row ? structuredClone(row) : null;
    },
    listByPlan: async (orgId, planId) => rows.filter((r) => r.orgId === orgId && r.planId === planId).map((r) => structuredClone(r)),
    save: async (orgId, sheet) => {
      const i = rows.findIndex((r) => r.id === sheet.id && r.orgId === orgId);
      if (i < 0) rows.push(structuredClone({ ...sheet, orgId }));
      else rows[i] = structuredClone({ ...sheet, orgId });
    },
    nextId: () => "sheet-" + ++nextIdCounter,
    now: () => "2026-10-23T12:00:00.000Z",
  };

  return {
    service: createJobCostDraftDomain(store), store, rows,
    deny: () => { allowed = false; },
    tenant: (t: string) => { tenant = t; },
    setFacts: (planId: string, f: JobCostFacts) => { factsByPlan.set(planId, f); },
  };
}

describe("job-costing Draft CRUD domain (J3)", () => {
  it("creates a Draft, allocates revision 1 and replays the identical DTO for the same idempotency key", async () => {
    const f = fixture();
    const sheet = await f.service.createDraft({ input: input() }, "key-1");
    expect(sheet).toMatchObject({ planId: "plan-1", productSku: "FG", revision: 1, version: 1, status: "Draft" });
    expect(await f.service.createDraft({ input: input() }, "key-1")).toEqual(sheet);
    expect(f.rows).toHaveLength(1);
  });

  it("allocates the next revision per (org, plan), not per sheet row", async () => {
    const f = fixture();
    const first = await f.service.createDraft({ input: input() }, "k1");
    const second = await f.service.createDraft({ input: input() }, "k2");
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(second.id).not.toBe(first.id);
  });

  it("round-trips the full JobCostCalculation structure through JSONB-shaped persistence (structural equality)", async () => {
    const f = fixture();
    const sheet = await f.service.createDraft({ input: input() }, "k1");
    const expected = calculateJobCost(input(), facts());
    // The store fixture persists via structuredClone (same object-identity discipline a
    // real PostgreSQL JSONB column roundtrip enforces: no live references survive).
    expect(sheet.calculation).toEqual(expected);
    const reread = await f.service.getDraft(sheet.id);
    expect(reread?.calculation).toEqual(expected);
    expect(reread?.calculation).not.toBe(sheet.calculation);
  });

  describe("ownership", () => {
    it("never returns another tenant's draft by id", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      f.tenant("org-B");
      expect(await f.service.getDraft(sheet.id)).toBeNull();
      f.tenant("org-A");
      expect(await f.service.getDraft(sheet.id)).not.toBeNull();
    });

    it("never lists another tenant's drafts for the same planId", async () => {
      const f = fixture();
      await f.service.createDraft({ input: input() }, "k1");
      f.tenant("org-B");
      f.setFacts("plan-1", facts({ orgId: "org-B" }));
      expect(await f.service.listDraftsByPlan("plan-1")).toHaveLength(0);
    });

    it("rejects creating against a plan belonging to a different tenant (source adapter ownership proof)", async () => {
      const f = fixture();
      f.tenant("org-B");
      await expect(f.service.createDraft({ input: input() }, "k1")).rejects.toMatchObject({ status: 404 });
    });

    it("rechecks live authorization inside the mutation's transaction boundary, not just at entry", async () => {
      const f = fixture();
      const originalMutate = f.store.mutate.bind(f.store);
      f.store.mutate = ((actor, op, key, payload, work) => {
        f.deny();
        return originalMutate(actor, op, key, payload, work);
      }) as typeof f.store.mutate;
      await expect(f.service.createDraft({ input: input() }, "k1")).rejects.toMatchObject({ status: 403 });
      expect(f.rows).toHaveLength(0);
    });
  });

  describe("immutability", () => {
    it("rejects an update attempting to move the sheet to a different plan", async () => {
      const f = fixture();
      f.setFacts("plan-2", facts({ plan: { ...facts().plan, planId: "plan-2" } }));
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      await expect(f.service.updateDraft(sheet.id, { input: input({ planId: "plan-2" }), expectedVersion: 1 }, "k2"))
        .rejects.toMatchObject({ status: 409 });
    });

    it("rejects an update where the server-derived product SKU would drift under the same sheet identity", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      f.setFacts("plan-1", facts({ plan: { ...facts().plan, productSku: "FG-OTHER" } }));
      await expect(f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2"))
        .rejects.toMatchObject({ status: 409 });
    });
  });

  describe("concurrency and idempotency", () => {
    it("rejects a stale expectedVersion (optimistic concurrency conflict)", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      await f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2");
      await expect(f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k3"))
        .rejects.toMatchObject({ status: 409 });
    });

    it("recalculates and bumps version on a valid update", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      const updated = await f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2");
      expect(updated.version).toBe(2);
      expect(updated.id).toBe(sheet.id);
      expect(updated.revision).toBe(sheet.revision);
    });

    it("replays the exact accepted DTO for a repeated idempotency key with the identical payload", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      const update1 = await f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2");
      const replay = await f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2");
      expect(replay).toEqual(update1);
    });

    it("rejects replaying the same idempotency key with a different actor/operation/payload", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      await f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2");
      await expect(f.service.updateDraft(sheet.id, { input: input({ asOfDate: "2026-10-22" }), expectedVersion: 1 }, "k2"))
        .rejects.toMatchObject({ status: 409 });
    });

    it("requires a nonempty Idempotency-Key for every mutation", async () => {
      const f = fixture();
      await expect(f.service.createDraft({ input: input() }, "")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("rollback on mutation failure", () => {
    it("leaves no partial row and no receipt when the persistence write fails mid-mutation", async () => {
      const f = fixture();
      const failingSave = vi.fn(async () => { throw new Error("simulated constraint violation"); });
      f.store.save = failingSave;
      await expect(f.service.createDraft({ input: input() }, "k1")).rejects.toThrow("simulated constraint violation");
      expect(f.rows).toHaveLength(0);
      // Retrying with the same key after the underlying fault is fixed must re-execute
      // (no receipt was durably committed for the failed attempt), not return a corrupt replay.
      f.store.save = async (orgId, sheet) => { f.rows.push({ ...sheet, orgId }); };
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      expect(sheet.revision).toBe(1);
      expect(f.rows).toHaveLength(1);
    });

    it("leaves the prior Draft version untouched when a recalculation update fails to persist", async () => {
      const f = fixture();
      const sheet = await f.service.createDraft({ input: input() }, "k1");
      f.store.save = vi.fn(async () => { throw new Error("simulated rollback"); });
      await expect(f.service.updateDraft(sheet.id, { input: input(), expectedVersion: 1 }, "k2")).rejects.toThrow("simulated rollback");
      expect(f.rows[0].version).toBe(1);
    });
  });

  describe("supersedesId (reserved for J4; validated honestly, not silently ignored)", () => {
    it("rejects supersedesId pointing at a sheet that is not Finalized (no finalize exists yet in J3)", async () => {
      const f = fixture();
      const parent = await f.service.createDraft({ input: input() }, "k1");
      await expect(f.service.createDraft({ input: input(), supersedesId: parent.id } as never, "k2"))
        .rejects.toMatchObject({ status: 409 });
    });

    it("rejects supersedesId pointing at a nonexistent or cross-tenant sheet id", async () => {
      const f = fixture();
      await expect(f.service.createDraft({ input: input(), supersedesId: "missing" } as never, "k1"))
        .rejects.toMatchObject({ status: 409 });
    });
  });
});
