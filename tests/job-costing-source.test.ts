import { describe, expect, it } from "vitest";
import { calculateJobCost } from "@/lib/job-costing/engine";
import type { JobCostInput } from "@/lib/job-costing/types";
import {
  buildJobCostFacts,
  composeJobCostFacts,
  type JobSourceParams,
  type JobSourceStore,
  type RawGeneralPoLine,
  type RawPlan,
  type RawPlanMaterial,
  type RawPurchaseRateRow,
  type RawStandardRateRow,
  type RawStockMovement,
} from "@/lib/job-costing/source";

const PARAMS: JobSourceParams = { orgId: "org-1", planId: "plan-1", asOfDate: "2026-10-23", capturedBy: "actor-1" };

function basePlan(overrides: Partial<RawPlan> = {}): RawPlan {
  return {
    planId: "plan-1", orgId: "org-1", jobNo: "JOB-1", productSku: "FG", productName: "Finished product",
    bomId: "bom-1", bomVersion: "1", status: "Completed", startedAt: "2026-10-22T05:00:00.000Z", ...overrides,
  };
}
function baseMaterial(overrides: Partial<RawPlanMaterial> = {}): RawPlanMaterial {
  return { sku: "RM", itemName: "Raw material", uom: "kg", requiredQty: "999", consumedQty: "2.125", ...overrides };
}
function issueMovement(overrides: Partial<RawStockMovement> = {}): RawStockMovement {
  return {
    id: "issue-1", timestamp: "2026-10-22T05:00:00.000Z", sku: "RM", uom: "kg",
    direction: "Out", quantity: "2.125", source: "Production", referenceId: "plan-1", userId: "issuer", ...overrides,
  };
}
function outputMovement(overrides: Partial<RawStockMovement> = {}): RawStockMovement {
  return {
    id: "output-1", timestamp: "2026-10-23T05:00:00.000Z", sku: "FG", uom: "pcs",
    direction: "In", quantity: "3", source: "Production_Output", referenceId: "plan-1", userId: "finisher", ...overrides,
  };
}
function purchaseRow(overrides: Partial<RawPurchaseRateRow> = {}): RawPurchaseRateRow {
  return {
    poId: "po-1", lineId: "pol-1", indentId: "ind-1", receiptId: "receipt-1", uom: "kg",
    newPrice: "4.12", oldPrice: "4.00", receivedAt: "2026-10-21T05:00:00.000Z",
    poStatus: "Completed", indentStatus: "Received", ...overrides,
  };
}
function standardRow(overrides: Partial<RawStandardRateRow> = {}): RawStandardRateRow {
  return {
    standardId: "std-1", uom: "kg", rate: "4.00", effectiveDate: "2026-10-01",
    approvedBy: "approver", approvedAt: "2026-10-01T00:00:00.000Z", reason: "Approved standard", ...overrides,
  };
}
function generalLine(overrides: Partial<RawGeneralPoLine> = {}): RawGeneralPoLine {
  return {
    poId: "gpo-1", lineId: "gpol-1", planId: "plan-1", poStatus: "Completed", uom: "service",
    qty: "10", rate: "2.5", amount: "25.00", receivedQty: "4",
    headerReceivedAt: "2026-10-23T06:00:00.000Z", headerReceivedBy: "receiver", invoiceUrl: "", ...overrides,
  };
}

interface Raw {
  plan: RawPlan; productUom: string | null; materials: RawPlanMaterial[]; movements: RawStockMovement[];
  fmsRunIds: string[]; purchaseCandidatesBySku: Map<string, RawPurchaseRateRow[]>;
  standardCandidatesBySku: Map<string, RawStandardRateRow[]>; generalLines: RawGeneralPoLine[];
}
function baseRaw(overrides: Partial<Raw> = {}): Raw {
  return {
    plan: basePlan(), productUom: "pcs", materials: [baseMaterial()], movements: [issueMovement(), outputMovement()],
    fmsRunIds: [], purchaseCandidatesBySku: new Map([["RM", [purchaseRow()]]]),
    standardCandidatesBySku: new Map([["RM", [standardRow()]]]), generalLines: [], ...overrides,
  };
}
function baseInput(overrides: Partial<JobCostInput> = {}): JobCostInput {
  return {
    planId: "plan-1", asOfDate: "2026-10-23",
    headDecisions: (["Labour", "DirectExpense", "FactoryOverhead", "Commercial"] as const).map((head) => ({
      head, status: "NotApplicable", reason: "Not required for this job",
    })),
    charges: [], generalDecisions: [], ...overrides,
  };
}

function storeFromRaw(raw: Raw): JobSourceStore {
  return {
    async loadPlan(orgId, planId) { return orgId === raw.plan.orgId && planId === raw.plan.planId ? raw.plan : null; },
    async loadItemUom() { return raw.productUom; },
    async loadPlanMaterials() { return raw.materials; },
    async loadPlanMovements() { return raw.movements; },
    async loadFmsRunIds() { return raw.fmsRunIds; },
    async loadPurchaseRateCandidates(_orgId, sku) { return raw.purchaseCandidatesBySku.get(sku) ?? []; },
    async loadStandardRates(_orgId, sku) { return raw.standardCandidatesBySku.get(sku) ?? []; },
    async loadGeneralPoLines() { return raw.generalLines; },
  };
}

describe("composeJobCostFacts: clean reconciled case", () => {
  it("produces canFinalize-eligible facts through the real J1 engine", async () => {
    const raw = baseRaw();
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.plan).toMatchObject({ planId: "plan-1", productSku: "FG", productUom: "pcs", status: "Completed" });
    expect(facts.materials).toHaveLength(1);
    expect(facts.materials[0]).toMatchObject({ reconciliation: "Reconciled", valuation: { kind: "PurchaseAgreedProvisional", rate: "4.12" } });
    expect(facts.output.events).toHaveLength(1);
    expect(facts.diagnostics).toHaveLength(0);
    const result = calculateJobCost(baseInput(), facts);
    expect(result.canFinalize).toBe(true);
    expect(result.sourceComplete).toBe(true);
  });

  it("falls back to the approved standard when no eligible purchase receipt exists", async () => {
    const raw = baseRaw({ purchaseCandidatesBySku: new Map([["RM", []]]) });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.materials[0].valuation).toMatchObject({ kind: "ApprovedStandardProvisional", standardId: "std-1" });
  });

  it("never fabricates a rate when neither purchase nor standard evidence qualifies", async () => {
    const raw = baseRaw({ purchaseCandidatesBySku: new Map([["RM", []]]), standardCandidatesBySku: new Map([["RM", []]]) });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.materials[0].valuation).toEqual({ kind: "Missing" });
    const result = calculateJobCost(baseInput(), facts);
    expect(result.diagnostics.some((d) => d.code === "MATERIAL_RATE_UNAVAILABLE")).toBe(true);
    expect(result.canFinalize).toBe(false);
  });
});

describe("composeJobCostFacts: material issue reconciliation defects", () => {
  it("blocks a missing issue with MATERIAL_UNRECONCILED (no substituted consumedQty)", async () => {
    const raw = baseRaw({ movements: [outputMovement()] });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.materials[0].issues).toHaveLength(0);
    expect(facts.materials[0].consumedQty).toBe("2.125");
    const result = calculateJobCost(baseInput(), facts);
    expect(result.diagnostics.some((d) => d.code === "MATERIAL_UNRECONCILED")).toBe(true);
    expect(result.canFinalize).toBe(false);
  });

  it("surfaces a duplicate issue as MATERIAL_UNRECONCILED, never summed", async () => {
    const raw = baseRaw({ movements: [issueMovement(), issueMovement({ id: "issue-2" }), outputMovement()] });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.materials[0].issues).toHaveLength(2);
    expect(facts.materials[0].reconciliation).toBe("Reconciled");
    const result = calculateJobCost(baseInput(), facts);
    expect(result.diagnostics.some((d) => d.code === "MATERIAL_UNRECONCILED")).toBe(true);
    expect(result.canFinalize).toBe(false);
  });

  it("flags a UOM-mismatched issue as MATERIAL_UOM_MISMATCH and drops it from issues[]", async () => {
    const raw = baseRaw({ movements: [issueMovement({ uom: "ltr" }), outputMovement()] });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.materials[0].issues).toHaveLength(0);
    expect(facts.materials[0].reconciliation).toBe("Incomplete");
    expect(facts.diagnostics).toEqual([
      expect.objectContaining({ code: "MATERIAL_UOM_MISMATCH", blocking: true, sourceIds: ["RM", "issue-1"] }),
    ]);
    const result = calculateJobCost(baseInput(), facts);
    expect(result.canFinalize).toBe(false);
  });

  it("discloses an unknown-SKU production issue instead of silently dropping it", async () => {
    const raw = baseRaw({ movements: [issueMovement(), outputMovement(), issueMovement({ id: "issue-x", sku: "GHOST" })] });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SKU_MATERIAL_ISSUE", sourceIds: ["issue-x", "GHOST"] }));
    const result = calculateJobCost(baseInput(), facts);
    expect(result.canFinalize).toBe(false);
  });

  it("discloses an unlinked Manual/Adjustment movement rather than netting it", async () => {
    const raw = baseRaw({ movements: [issueMovement(), outputMovement(), issueMovement({ id: "adj-1", source: "Adjustment", sku: "RM" })] });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: "UNCLASSIFIED_PLAN_MOVEMENT", sourceIds: ["adj-1"] }));
  });
});

describe("composeJobCostFacts: FMS-linked plans", () => {
  it("flags any FMS run id so the J1 engine raises FMS_OUTPUT_UNSUPPORTED", async () => {
    const raw = baseRaw({ fmsRunIds: ["run-1"] });
    const facts = await buildJobCostFacts(storeFromRaw(raw), PARAMS);
    expect(facts.output.runIds).toEqual(["run-1"]);
    const result = calculateJobCost(baseInput(), facts);
    expect(result.diagnostics.some((d) => d.code === "FMS_OUTPUT_UNSUPPORTED")).toBe(true);
    expect(result.canFinalize).toBe(false);
    // Start quantity is never substituted as output just because a Line is tracking it.
    expect(result.output.quantity).toBeNull();
  });
});

describe("composeJobCostFacts: General PO line eligibility", () => {
  const withGeneral = (overrides: Partial<RawGeneralPoLine>) => baseRaw({ generalLines: [generalLine(overrides)] });

  it("classifies a received Completed line as Eligible with a correct pre-tax cap", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({})), PARAMS);
    const input = baseInput({
      headDecisions: baseInput().headDecisions.map((d) => (d.head === "DirectExpense" ? { ...d, status: "Entered" } : d)),
      generalDecisions: [{ lineId: "gpol-1", classification: "DirectExpense", allocatedAmount: "10", basis: "Received service", reason: "Attributable" }],
    });
    const result = calculateJobCost(input, facts);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "Eligible", eligibleCap: "10.00", allocatedAmount: "10.00" });
  });

  it("classifies an Open (not yet received) line as Committed, excluded from cost", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({ poStatus: "Open", receivedQty: null, headerReceivedAt: null, headerReceivedBy: null })), PARAMS);
    expect(facts.generalSources[0].status).toBe("Open");
    const result = calculateJobCost(baseInput(), facts);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "Committed", eligibleCap: null, allocatedAmount: "0.00" });
  });

  it("classifies malformed/overreceived evidence as Unavailable, not clamped", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({ receivedQty: "11" })), PARAMS);
    const result = calculateJobCost(baseInput(), facts);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "Unavailable" });
    expect(result.canFinalize).toBe(false);
  });

  it("classifies explicitly zero received as ZeroReceived, cap zero, not cost-bearing", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({ receivedQty: "0" })), PARAMS);
    const result = calculateJobCost(baseInput(), facts);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "ZeroReceived", eligibleCap: "0.00", allocatedAmount: "0.00" });
    expect(result.canFinalize).toBe(true);
  });

  it("excludes a Cancelled general PO from cost as Committed-shaped (never charged)", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({ poStatus: "Cancelled", receivedQty: null, headerReceivedAt: null, headerReceivedBy: null })), PARAMS);
    const result = calculateJobCost(baseInput(), facts);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "Committed", allocatedAmount: "0.00" });
  });

  it("never inherits another plan's General PO line (exact planId match)", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(baseRaw({ generalLines: [generalLine({ planId: "other-plan" })] })), PARAMS);
    expect(facts.generalSources).toHaveLength(0);
  });

  it("excludes a general line with a malformed decimal rather than defaulting it to zero", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({ rate: "-1" })), PARAMS);
    expect(facts.generalSources).toHaveLength(0);
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: "GENERAL_LINE_MALFORMED_SOURCE", blocking: true }));
  });

  it("excludes a general line with a blank recorded UOM rather than inventing one", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({ uom: "" })), PARAMS);
    expect(facts.generalSources).toHaveLength(0);
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: "GENERAL_LINE_MALFORMED_SOURCE", sourceIds: ["gpol-1"] }));
  });

  it("always reports zero activeAllocatedAmount — no J3/J4 persistence exists yet to supply live claims", async () => {
    const facts = await buildJobCostFacts(storeFromRaw(withGeneral({})), PARAMS);
    expect(facts.generalSources[0].activeAllocatedAmount).toBe("0.00");
  });
});

describe("composeJobCostFacts: no silent zero/default substitution", () => {
  it("refuses to build facts when the product Items master is missing, rather than inventing a blank UOM", async () => {
    const raw = baseRaw({ productUom: null });
    await expect(buildJobCostFacts(storeFromRaw(raw), PARAMS)).rejects.toThrow(/Items-master/);
  });

  it("throws rather than silently cross-wiring facts for a different tenant/plan", () => {
    const raw = baseRaw();
    expect(() => composeJobCostFacts(PARAMS, { ...raw, plan: { ...raw.plan, orgId: "other-org" } }, "2026-10-23T12:00:00.000Z")).toThrow();
    expect(() => composeJobCostFacts(PARAMS, { ...raw, plan: { ...raw.plan, planId: "other-plan" } }, "2026-10-23T12:00:00.000Z")).toThrow();
  });

  it("maps real Ready/Shortage plan statuses through unchanged (J3 widened enum)", async () => {
    const ready = baseRaw({ plan: basePlan({ status: "Ready", startedAt: null }) });
    const readyFacts = await buildJobCostFacts(storeFromRaw(ready), PARAMS);
    expect(readyFacts.plan.status).toBe("Ready");
    const shortage = baseRaw({ plan: basePlan({ status: "Shortage", startedAt: null }) });
    const shortageFacts = await buildJobCostFacts(storeFromRaw(shortage), PARAMS);
    expect(shortageFacts.plan.status).toBe("Shortage");
  });

  it("surfaces an unavailable plan as a thrown JobSourceError, never an empty facts object", async () => {
    const store = storeFromRaw(baseRaw());
    await expect(buildJobCostFacts(store, { ...PARAMS, planId: "missing-plan" })).rejects.toThrow();
  });
});
