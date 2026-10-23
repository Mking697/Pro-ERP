import { describe, expect, it } from "vitest";
import { createJobCostDraftDomain, JobCostStoreError, type JobCostDraftStore } from "@/lib/job-costing/store";
import {
  createJobCostFinalizeDomain,
  type JobCostAllocationRecord,
  type JobCostFinalizeStore,
  type JobCostLineagePointer,
} from "@/lib/job-costing/finalize";
import { calculateJobCost } from "@/lib/job-costing/engine";
import type { JobCostFacts, JobCostInput, JobCostSheet } from "@/lib/job-costing/types";

function input(overrides: Partial<JobCostInput> = {}): JobCostInput {
  return {
    planId: "plan-1",
    asOfDate: "2026-10-23",
    headDecisions: ([
      { head: "Labour", status: "NotApplicable", reason: "Not required for this job" },
      { head: "DirectExpense", status: "Entered", reason: "General PO expense charged" },
      { head: "FactoryOverhead", status: "NotApplicable", reason: "Not required for this job" },
      { head: "Commercial", status: "NotApplicable", reason: "Not required for this job" },
    ] as const),
    charges: [],
    generalDecisions: [
      { lineId: "gpol-1", classification: "DirectExpense", allocatedAmount: "30.00", basis: "Received General PO expense", reason: "Freight for this job" },
    ],
    ...overrides,
  };
}

function generalSource(overrides: Partial<JobCostFacts["generalSources"][number]> = {}): JobCostFacts["generalSources"][number] {
  return {
    poId: "po-1", lineId: "gpol-1", planId: "plan-1", status: "Completed",
    orderedQty: "10", receivedQty: "10", receivedAt: "2026-10-22T06:00:00.000Z", receivedBy: "receiver",
    uom: "pcs", rate: "10", orderedAmount: "100.00", sourceFingerprint: "gpol-fp-1",
    activeAllocatedAmount: "0.00", reconciliation: "Reconciled", evidenceRefs: [],
    ...overrides,
  };
}

function facts(overrides: Partial<JobCostFacts> = {}): JobCostFacts {
  return {
    orgId: "org-A", capturedAt: "2026-10-23T12:00:00.000Z", capturedBy: "actor-1", sourceFingerprint: "fingerprint-1",
    plan: { planId: "plan-1", jobNo: "JOB-1", productSku: "FG", productName: "Finished product", productUom: "pcs", bomId: "bom-1", bomVersion: "1", status: "Completed", startedAt: "2026-10-22T05:00:00.000Z" },
    materials: [{
      sku: "RM", name: "Raw material", uom: "kg", requiredQty: "999", consumedQty: "2.125", reconciliation: "Reconciled",
      issues: [{ id: "issue-1", timestamp: "2026-10-22T05:00:00.000Z", quantity: "2.125", userId: "issuer" }],
      valuation: { kind: "PurchaseAgreedProvisional", rate: "4.12", uom: "kg", currency: "INR", date: "2026-10-21T05:00:00.000Z", poId: "po-rm", lineId: "pol-rm", indentId: "ind-rm", receiptId: "receipt-rm" },
    }],
    output: { reconciliation: "Reconciled", runIds: [], events: [{ id: "output-1", timestamp: "2026-10-23T05:00:00.000Z", quantity: "3", userId: "finisher", sku: "FG", uom: "pcs", referenceId: "plan-1", source: "Production_Output", direction: "In" }] },
    generalSources: [generalSource()],
    diagnostics: [],
    ...overrides,
  };
}

/** No General PO lines/decisions at all — used for the race tests so lineage contention
 * is the only thing under test, not allocation-cap arithmetic. */
function simpleInput(overrides: Partial<JobCostInput> = {}): JobCostInput {
  return {
    planId: "plan-1", asOfDate: "2026-10-23",
    headDecisions: (["Labour", "DirectExpense", "FactoryOverhead", "Commercial"] as const).map((head) => ({
      head, status: "NotApplicable", reason: "Not required for this job",
    })),
    charges: [], generalDecisions: [], ...overrides,
  };
}
function simpleFacts(overrides: Partial<JobCostFacts> = {}): JobCostFacts {
  return facts({ generalSources: [], ...overrides });
}

/** Combined in-memory fixture backing BOTH `JobCostDraftStore` (to create/supersede Drafts,
 * reusing J3's own domain unmodified) and `JobCostFinalizeStore` (the module under test) over
 * the SAME underlying `sheets` rows — mirrors one shared `job_cost_sheets` table. No DB/HTTP
 * import, consistent with `tests/job-costing-store.test.ts`'s fixture discipline. */
function fixture() {
  const sheets: (JobCostSheet & { orgId: string })[] = [];
  const lineages = new Map<string, JobCostLineagePointer>();
  const allocations: (JobCostAllocationRecord & { orgId: string })[] = [];
  const receipts = new Map<string, { payload: string; value: unknown }>();
  let allowed = true;
  let tenant = "org-A";
  const factsByPlan = new Map<string, JobCostFacts>([["plan-1", facts()]]);
  let nextIdCounter = 0;
  let nextAllocCounter = 0;
  let recompute: JobCostFinalizeStore["recompute"] = (i, f) => calculateJobCost(i, f);

  const lineageKey = (orgId: string, planId: string) => orgId + ":" + planId;

  async function mutate<T>(actor: { orgId: string; actorId: string }, operation: string, key: string, payload: unknown, work: () => Promise<T>) {
    const hash = JSON.stringify({ actor, operation, payload });
    const receiptKey = actor.orgId + ":" + key;
    const existing = receipts.get(receiptKey);
    if (existing) {
      if (existing.payload !== hash) throw new JobCostStoreError("Idempotency key conflict: different actor/operation/payload", 409);
      return structuredClone(existing.value) as T;
    }
    const result = await work();
    receipts.set(receiptKey, { payload: hash, value: structuredClone(result) });
    return result;
  }

  const draftStore: JobCostDraftStore = {
    authorize: async () => { if (!allowed) throw new JobCostStoreError("Forbidden", 403); return { orgId: tenant, actorId: "U" }; },
    mutate,
    buildFacts: async ({ orgId, planId }) => {
      const f = factsByPlan.get(planId);
      if (!f || f.orgId !== orgId) throw new JobCostStoreError("Production plan not found for this tenant", 404);
      return structuredClone(f);
    },
    get: async (orgId, id) => { const row = sheets.find((r) => r.id === id && r.orgId === orgId); return row ? structuredClone(row) : null; },
    listByPlan: async (orgId, planId) => sheets.filter((r) => r.orgId === orgId && r.planId === planId).map((r) => structuredClone(r)),
    save: async (orgId, sheet) => {
      const i = sheets.findIndex((r) => r.id === sheet.id && r.orgId === orgId);
      if (i < 0) sheets.push(structuredClone({ ...sheet, orgId }));
      else sheets[i] = structuredClone({ ...sheet, orgId });
    },
    nextId: () => "sheet-" + ++nextIdCounter,
    now: () => "2026-10-23T12:00:00.000Z",
  };

  const finalizeStore: JobCostFinalizeStore = {
    authorize: draftStore.authorize,
    mutate,
    buildFacts: draftStore.buildFacts,
    recompute: (i, f) => recompute(i, f),
    getSheet: draftStore.get,
    finalizeSheetRow: async (orgId, sheet, expectedVersion) => {
      const i = sheets.findIndex((r) => r.id === sheet.id && r.orgId === orgId);
      if (i < 0) throw new JobCostStoreError("Job cost sheet not found", 404);
      if (sheets[i].status !== "Draft" || sheets[i].version !== expectedVersion) {
        throw new JobCostStoreError("Job cost sheet is finalized or version is stale", 409);
      }
      sheets[i] = structuredClone({ ...sheet, orgId });
    },
    nextAllocationId: () => "alloc-" + ++nextAllocCounter,
    now: () => "2026-10-23T12:00:00.000Z",
    getLineage: async (orgId, planId) => {
      const l = lineages.get(lineageKey(orgId, planId));
      return l ? structuredClone(l) : null;
    },
    createLineage: async (orgId, planId, sheetId) => {
      const key = lineageKey(orgId, planId);
      if (lineages.has(key)) return false;
      lineages.set(key, { activeFinalizedSheetId: sheetId, version: 1 });
      return true;
    },
    advanceLineage: async (orgId, planId, fromSheetId, toSheetId) => {
      const key = lineageKey(orgId, planId);
      const current = lineages.get(key);
      if (!current || current.activeFinalizedSheetId !== fromSheetId) return false;
      lineages.set(key, { activeFinalizedSheetId: toSheetId, version: current.version + 1 });
      return true;
    },
    listActiveAllocations: async (orgId, sourceIds) =>
      allocations.filter((a) => a.orgId === orgId && a.active && sourceIds.includes(a.sourceId)).map((a) => structuredClone(a)),
    insertAllocations: async (orgId, rows) => { for (const r of rows) allocations.push(structuredClone({ ...r, orgId })); },
    deactivateAllocations: async (orgId, sheetId) => {
      for (const a of allocations) if (a.orgId === orgId && a.sheetId === sheetId) a.active = false;
    },
  };

  return {
    draftService: createJobCostDraftDomain(draftStore),
    finalizeService: createJobCostFinalizeDomain(finalizeStore),
    finalizeStore,
    sheets, lineages, allocations,
    deny: () => { allowed = false; },
    tenant: (t: string) => { tenant = t; },
    setFacts: (planId: string, f: JobCostFacts) => { factsByPlan.set(planId, f); },
    setRecompute: (fn: JobCostFinalizeStore["recompute"]) => { recompute = fn; },
  };
}

describe("job-costing finalize domain (J4)", () => {
  it("first finalize: marks the sheet Finalized, inserts allocation rows for cost-bearing General PO lines, and creates the lineage pointer", async () => {
    const f = fixture();
    const draft = await f.draftService.createDraft({ input: input() }, "k1");
    expect(draft.calculation.canFinalize).toBe(true);

    const finalized = await f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1");

    expect(finalized.status).toBe("Finalized");
    expect(finalized.version).toBe(2);
    expect(finalized.finalizedBy).toBe("U");
    expect(finalized.finalizedAt).not.toBeNull();

    expect(f.allocations).toHaveLength(1);
    expect(f.allocations[0]).toMatchObject({ sheetId: draft.id, sourceId: "gpol-1", poId: "po-1", head: "DirectExpense", allocatedAmount: "30.00", eligibleCap: "100.00", active: true });

    expect(f.lineages.get("org-A:plan-1")).toEqual({ activeFinalizedSheetId: draft.id, version: 1 });

    // Replay with the same key returns the identical accepted DTO, no second write.
    const replay = await f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1");
    expect(replay).toEqual(finalized);
    expect(f.allocations).toHaveLength(1);
  });

  it("blocks finalize when the Draft's recomputed calculation is not sourceComplete/valuationComplete/canFinalize", async () => {
    const f = fixture();
    f.setFacts("plan-1", facts({ output: { reconciliation: "Reconciled", runIds: [], events: [] }, generalSources: [] }));
    const draft = await f.draftService.createDraft({ input: input({ generalDecisions: [] }) }, "k1");
    expect(draft.calculation.canFinalize).toBe(false);

    await expect(
      f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
    ).rejects.toMatchObject({ status: 409 });
    expect(f.sheets[0].status).toBe("Draft");
    expect(f.allocations).toHaveLength(0);
    expect(f.lineages.size).toBe(0);
  });

  it("rejects a stale expectedVersion before touching evidence or allocations", async () => {
    const f = fixture();
    const draft = await f.draftService.createDraft({ input: input() }, "k1");
    await expect(
      f.finalizeService.finalize(draft.id, { expectedVersion: 2, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
    ).rejects.toMatchObject({ status: 409 });
    expect(f.allocations).toHaveLength(0);
  });

  describe("source fingerprint (409, never silently repriced)", () => {
    it("rejects when the caller's submitted sourceFingerprint does not match the saved Draft", async () => {
      const f = fixture();
      const draft = await f.draftService.createDraft({ input: input() }, "k1");
      await expect(
        f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: "stale-fingerprint" }, "fk1")
      ).rejects.toMatchObject({ status: 409 });
      expect(f.allocations).toHaveLength(0);
      expect(f.lineages.size).toBe(0);
    });

    it("rejects when the current source evidence has drifted since the Draft was saved (fresh recompute disagrees)", async () => {
      const f = fixture();
      const draft = await f.draftService.createDraft({ input: input() }, "k1");
      // Evidence changed underneath the Draft (e.g. the General PO line's receipt facts
      // were corrected) — the freshly rebuilt fingerprint now disagrees with the saved one.
      f.setFacts("plan-1", facts({ sourceFingerprint: "fingerprint-2", generalSources: [generalSource({ receivedQty: "9" })] }));
      await expect(
        f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
      ).rejects.toMatchObject({ status: 409 });
      expect(f.sheets[0].status).toBe("Draft");
      expect(f.allocations).toHaveLength(0);
      expect(f.lineages.size).toBe(0);
    });
  });

  it("rejects the whole finalize (no partial allocation) when the requested allocation would exceed the cap net of other active claims", async () => {
    const f = fixture();
    const draft = await f.draftService.createDraft({ input: input() }, "k1");
    // Simulate another already-active allocation (any sheet) on the same General PO line:
    // 80.00 active + this sheet's 30.00 request = 110.00 > the 100.00 eligible cap.
    f.allocations.push({
      id: "alloc-seed", orgId: "org-A", sheetId: "other-sheet", sourceKind: "GeneralPOLine", sourceId: "gpol-1",
      poId: "po-1", planId: "plan-1", head: "DirectExpense", allocatedAmount: "80.00", eligibleCap: "100.00",
      sourceFingerprint: "x", facts: {}, basis: "GeneralPOLineReceipt", reason: "seed", approvedBy: "U", approvedAt: "2026-10-23T00:00:00.000Z", active: true,
    });

    await expect(
      f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
    ).rejects.toMatchObject({ status: 409 });
    expect(f.sheets[0].status).toBe("Draft");
    expect(f.allocations).toHaveLength(1); // only the pre-seeded row; nothing partially inserted
    expect(f.lineages.size).toBe(0);
  });

  it("rejects duplicate allocation of the same source line twice within one sheet (defensive; structurally unreachable through the real engine)", async () => {
    const f = fixture();
    const draft = await f.draftService.createDraft({ input: input() }, "k1");
    // The real engine/zod schemas make a duplicate generalSources lineId structurally
    // impossible; this proves finalize's OWN guard, not a second source of truth, by
    // injecting a corrupted recompute result with the same sourceFingerprint.
    f.setRecompute((i, facts_) => {
      const calc = calculateJobCost(i, facts_);
      return { ...calc, generalSources: [...calc.generalSources, calc.generalSources[0]] };
    });

    await expect(
      f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
    ).rejects.toMatchObject({ status: 400 });
    expect(f.sheets[0].status).toBe("Draft");
    expect(f.allocations).toHaveLength(0);
  });

  it("successor finalize validates supersedesId against the active lineage pointer, deactivates the parent's allocations, inserts new ones and advances the pointer", async () => {
    const f = fixture();
    const parentDraft = await f.draftService.createDraft({ input: input() }, "k1");
    const parent = await f.finalizeService.finalize(parentDraft.id, { expectedVersion: 1, sourceFingerprint: parentDraft.calculation.sourceFingerprint }, "fk1");
    expect(f.allocations).toHaveLength(1);
    const parentAllocationId = f.allocations[0].id;

    const successorDraft = await f.draftService.createDraft(
      { input: input({ generalDecisions: [{ lineId: "gpol-1", classification: "DirectExpense", allocatedAmount: "40.00", basis: "Revised freight", reason: "Corrected amount" }] }), supersedesId: parent.id } as never,
      "k2"
    );
    expect(successorDraft.supersedesId).toBe(parent.id);

    const successor = await f.finalizeService.finalize(
      successorDraft.id,
      { expectedVersion: 1, sourceFingerprint: successorDraft.calculation.sourceFingerprint },
      "fk2"
    );

    expect(successor.status).toBe("Finalized");
    expect(f.lineages.get("org-A:plan-1")).toEqual({ activeFinalizedSheetId: successor.id, version: 2 });
    expect(f.allocations.find((a) => a.id === parentAllocationId)?.active).toBe(false);
    const successorAllocation = f.allocations.find((a) => a.sheetId === successor.id);
    expect(successorAllocation).toMatchObject({ sourceId: "gpol-1", allocatedAmount: "40.00", active: true });
  });

  it("rejects a successor finalize whose supersedesId no longer matches the active lineage pointer", async () => {
    const f = fixture();
    const parentDraft = await f.draftService.createDraft({ input: input() }, "k1");
    const parent = await f.finalizeService.finalize(parentDraft.id, { expectedVersion: 1, sourceFingerprint: parentDraft.calculation.sourceFingerprint }, "fk1");

    const successorDraft = await f.draftService.createDraft(
      { input: input({ generalDecisions: [{ lineId: "gpol-1", classification: "DirectExpense", allocatedAmount: "40.00", basis: "Revised", reason: "x" }] }), supersedesId: parent.id } as never,
      "k2"
    );
    const successor = await f.finalizeService.finalize(successorDraft.id, { expectedVersion: 1, sourceFingerprint: successorDraft.calculation.sourceFingerprint }, "fk2");

    // A third sheet still claiming the now-superseded parent as its own supersedesId must
    // be rejected — the active pointer has already moved on to `successor`.
    const staleThirdDraft = await f.draftService.createDraft(
      { input: input({ generalDecisions: [{ lineId: "gpol-1", classification: "DirectExpense", allocatedAmount: "10.00", basis: "x", reason: "x" }] }), supersedesId: parent.id } as never,
      "k3"
    );
    await expect(
      f.finalizeService.finalize(staleThirdDraft.id, { expectedVersion: 1, sourceFingerprint: staleThirdDraft.calculation.sourceFingerprint }, "fk3")
    ).rejects.toMatchObject({ status: 409 });
    expect(f.lineages.get("org-A:plan-1")?.activeFinalizedSheetId).toBe(successor.id);
  });

  describe("concurrent finalize (simulated race; exactly one winner)", () => {
    it("first finalize: two root Drafts for the same plan race to create the lineage — only one wins", async () => {
      const f = fixture();
      f.setFacts("plan-1", simpleFacts());
      const d1 = await f.draftService.createDraft({ input: simpleInput() }, "k1");
      const d2 = await f.draftService.createDraft({ input: simpleInput() }, "k2");

      const [r1, r2] = await Promise.allSettled([
        f.finalizeService.finalize(d1.id, { expectedVersion: 1, sourceFingerprint: d1.calculation.sourceFingerprint }, "race-1"),
        f.finalizeService.finalize(d2.id, { expectedVersion: 1, sourceFingerprint: d2.calculation.sourceFingerprint }, "race-2"),
      ]);

      const outcomes = [r1, r2];
      const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
      const rejected = outcomes.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

      expect(f.lineages.size).toBe(1);
      const winnerId = (fulfilled[0] as PromiseFulfilledResult<JobCostSheet>).value.id;
      expect(f.lineages.get("org-A:plan-1")?.activeFinalizedSheetId).toBe(winnerId);
      // The losing Draft must be left completely untouched — not partially Finalized.
      const loserId = winnerId === d1.id ? d2.id : d1.id;
      expect(f.sheets.find((s) => s.id === loserId)?.status).toBe("Draft");
      expect(f.sheets.find((s) => s.id === winnerId)?.status).toBe("Finalized");
    });

    it("successor finalize: two successor Drafts racing on the same parent — only one advances the lineage", async () => {
      const f = fixture();
      f.setFacts("plan-1", simpleFacts());
      const parentDraft = await f.draftService.createDraft({ input: simpleInput() }, "k1");
      const parent = await f.finalizeService.finalize(parentDraft.id, { expectedVersion: 1, sourceFingerprint: parentDraft.calculation.sourceFingerprint }, "fk1");

      const s1 = await f.draftService.createDraft({ input: simpleInput(), supersedesId: parent.id } as never, "k2");
      const s2 = await f.draftService.createDraft({ input: simpleInput(), supersedesId: parent.id } as never, "k3");

      const [r1, r2] = await Promise.allSettled([
        f.finalizeService.finalize(s1.id, { expectedVersion: 1, sourceFingerprint: s1.calculation.sourceFingerprint }, "race-s1"),
        f.finalizeService.finalize(s2.id, { expectedVersion: 1, sourceFingerprint: s2.calculation.sourceFingerprint }, "race-s2"),
      ]);

      const outcomes = [r1, r2];
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

      expect(f.lineages.get("org-A:plan-1")?.version).toBe(2);
      const pointer = f.lineages.get("org-A:plan-1")?.activeFinalizedSheetId;
      expect([s1.id, s2.id]).toContain(pointer);
    });
  });

  describe("ownership and authorization", () => {
    it("never finalizes another tenant's sheet", async () => {
      const f = fixture();
      const draft = await f.draftService.createDraft({ input: input() }, "k1");
      f.tenant("org-B");
      await expect(
        f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
      ).rejects.toMatchObject({ status: 404 });
    });

    it("rechecks live authorization inside the mutation's transaction boundary", async () => {
      const f = fixture();
      const draft = await f.draftService.createDraft({ input: input() }, "k1");
      const originalMutate = f.finalizeStore.mutate.bind(f.finalizeStore);
      f.finalizeStore.mutate = ((actor, op, key, payload, work) => {
        f.deny();
        return originalMutate(actor, op, key, payload, work);
      }) as typeof f.finalizeStore.mutate;
      await expect(
        f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "fk1")
      ).rejects.toMatchObject({ status: 403 });
      expect(f.allocations).toHaveLength(0);
    });

    it("requires a nonempty Idempotency-Key", async () => {
      const f = fixture();
      const draft = await f.draftService.createDraft({ input: input() }, "k1");
      await expect(
        f.finalizeService.finalize(draft.id, { expectedVersion: 1, sourceFingerprint: draft.calculation.sourceFingerprint }, "")
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
