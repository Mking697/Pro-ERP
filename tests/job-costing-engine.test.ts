import { describe, expect, it } from "vitest";
import { calculateJobCost } from "@/lib/job-costing/engine";
import type { JobCostFacts, JobCostInput } from "@/lib/job-costing/types";
import { parseJobCostInput, normalizeJobCostFacts, jobCutoffInstant } from "@/lib/job-costing/validation";

function input(): JobCostInput {
  return {
    planId: "plan-1", asOfDate: "2026-10-23",
    headDecisions: ["Labour", "DirectExpense", "FactoryOverhead", "Commercial"].map(head => ({
      head: head as JobCostInput["headDecisions"][number]["head"], status: "NotApplicable", reason: "Not required for this job",
    })), charges: [], generalDecisions: [],
  };
}
function facts(): JobCostFacts {
  return {
    orgId: "org-1", capturedAt: "2026-10-23T12:00:00.000Z", capturedBy: "actor-1", sourceFingerprint: "fingerprint-1",
    plan: { planId: "plan-1", jobNo: "JOB-1", productSku: "FG", productName: "Finished product", productUom: "pcs", bomId: "bom-1", bomVersion: "1", status: "Completed", startedAt: "2026-10-22T05:00:00.000Z" },
    materials: [{ sku: "RM", name: "Raw material", uom: "kg", requiredQty: "999", consumedQty: "2.125", reconciliation: "Reconciled",
      issues: [{ id: "issue-1", timestamp: "2026-10-22T05:00:00.000Z", quantity: "2.125", userId: "issuer" }],
      valuation: { kind: "PurchaseAgreedProvisional", rate: "4.12", uom: "kg", currency: "INR", date: "2026-10-21T05:00:00.000Z", poId: "po-1", lineId: "pol-1", indentId: "ind-1", receiptId: "receipt-1" } }],
    output: { reconciliation: "Reconciled", runIds: [], events: [{ id: "output-1", timestamp: "2026-10-23T05:00:00.000Z", quantity: "3", userId: "finisher", sku: "FG", uom: "pcs", referenceId: "plan-1", source: "Production_Output", direction: "In" }] },
    generalSources: [], diagnostics: [],
  };
}

function general(): JobCostFacts["generalSources"][number] {
  return { poId: "general-po-1", lineId: "general-line-1", planId: "plan-1", status: "Completed", orderedQty: "10", receivedQty: "4", receivedAt: "2026-10-23T06:00:00.000Z", receivedBy: "receiver", uom: "service", rate: "2.5", orderedAmount: "25.00", activeAllocatedAmount: "0", sourceFingerprint: "general-fingerprint", reconciliation: "Reconciled", evidenceRefs: ["invoice-1"] };
}
function generalInput(): JobCostInput {
  const draft = input(); draft.headDecisions[1].status = "Entered";
  draft.generalDecisions = [{ lineId: "general-line-1", classification: "DirectExpense", allocatedAmount: "10", basis: "All received service", reason: "Fully attributable to this job" }];
  return draft;
}

describe("General PO receipt classification and source allocation", () => {
  it("charges only classified received pre-tax expenses, not ordered commitments or material receipts", () => {
    const source = facts(); source.generalSources = [general()];
    const result = calculateJobCost(generalInput(), source);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "Eligible", eligibleCap: "10.00", allocatedAmount: "10.00" });
    expect(result.totals).toMatchObject({ material: "8.76", directExpenses: "10.00", manufacturing: "18.76", fullCost: "18.76" });
    expect(result.canFinalize).toBe(true);
  });
  it.each(["DirectExpense", "FactoryOverhead", "Commercial"] as const)("includes General expenses in explicitly selected %s only", classification => {
    const source = facts(); source.generalSources = [general()];
    const draft = input(); draft.headDecisions.find(d => d.head === classification)!.status = "Entered";
    draft.generalDecisions = [{ ...generalInput().generalDecisions[0], classification }];
    const result = calculateJobCost(draft, source);
    expect(result.canFinalize).toBe(true);
    expect(result.totals.fullCost).toBe("18.76");
    expect(result.totals.manufacturing).toBe(classification === "Commercial" ? "8.76" : "18.76");
  });
  it("blocks unclassified eligible expenses with known subtotals retained", () => {
    const source = facts(); source.generalSources = [general()];
    const result = calculateJobCost(input(), source);
    expect(result.generalSources[0].allocatedAmount).toBeNull();
    expect(result.totals).toMatchObject({ knownMaterialSubtotal: "8.76", labour: "0.00", directExpenses: null, factoryOverhead: null, commercial: null, manufacturing: null, fullCost: null });
    expect(result.sourceComplete).toBe(false);
    expect(result.canFinalize).toBe(false);
  });
  it.each(["ExcludedCapital", "ExcludedOther"] as const)("retains reasoned %s without charging the asset or inventing depreciation", classification => {
    const source = facts(); source.generalSources = [general()];
    const draft = input(); draft.generalDecisions = [{ ...generalInput().generalDecisions[0], classification, allocatedAmount: "0", basis: "Excluded", reason: "Not a job expense" }];
    const result = calculateJobCost(draft, source);
    expect(result.generalSources[0]).toMatchObject({ eligibleCap: "10.00", allocatedAmount: "0.00", decision: { classification, reason: "Not a job expense" } });
    expect(result.totals.fullCost).toBe("8.76");
    expect(result.canFinalize).toBe(true);
    expect(() => calculateJobCost({ ...draft, generalDecisions: [{ ...draft.generalDecisions[0], allocatedAmount: "10" }] }, source)).toThrow();
  });
  it("permits explicit partial allocation with a basis and reason for unused balance", () => {
    const source = facts(); source.generalSources = [{ ...general(), activeAllocatedAmount: "4" }];
    const draft = generalInput(); draft.generalDecisions[0].allocatedAmount = "6";
    draft.generalDecisions[0].basis = "60% documented job use";
    draft.generalDecisions[0].reason = "Remaining 40% already allocated elsewhere";
    const result = calculateJobCost(draft, source);
    expect(result.canFinalize).toBe(true);
    expect(result.totals.directExpenses).toBe("6.00");
    expect(() => calculateJobCost({ ...draft, generalDecisions: [{ ...draft.generalDecisions[0], reason: "" }] }, source)).toThrow();
  });
  it.each(["above-cap", "prior-claims", "corrupt-prior-claims"])("blocks %s allocations rather than clamping", kind => {
    const source = facts(); source.generalSources = [general()];
    const draft = generalInput();
    if (kind === "above-cap") draft.generalDecisions[0].allocatedAmount = "10.01";
    if (kind === "prior-claims") source.generalSources[0].activeAllocatedAmount = "0.01";
    if (kind === "corrupt-prior-claims") source.generalSources[0].activeAllocatedAmount = "10.01";
    const result = calculateJobCost(draft, source);
    expect(result.generalSources[0].allocatedAmount).toBeNull();
    expect(result.totals.directExpenses).toBeNull();
    expect(result.totals.knownDirectExpensesSubtotal).toBe("0.00");
    expect(result.canFinalize).toBe(false);
  });
  it.each(["Open", "Cancelled", "future-receipt"])("keeps %s commitments outside costs", status => {
    const source = facts(); source.generalSources = [general()];
    if (status === "future-receipt") source.generalSources[0].receivedAt = "2026-10-24T06:00:00.000Z";
    else source.generalSources[0].status = status as "Open" | "Cancelled";
    const result = calculateJobCost(input(), source);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "Committed", eligibleCap: null, allocatedAmount: "0.00" });
    expect(result.totals.fullCost).toBe("8.76");
    expect(result.canFinalize).toBe(true);
    const attempted = calculateJobCost(generalInput(), source);
    expect(attempted.canFinalize).toBe(false);
    expect(attempted.totals.directExpenses).toBeNull();
  });
  it.each(["null-received", "missing-receipt-time", "missing-actor", "over-received", "amount-mismatch", "unreconciled", "wrong-plan"])("blocks %s General evidence", kind => {
    const source = facts(); source.generalSources = [general()]; const line = source.generalSources[0];
    if (kind === "null-received") line.receivedQty = null;
    if (kind === "missing-receipt-time") line.receivedAt = null;
    if (kind === "missing-actor") line.receivedBy = null;
    if (kind === "over-received") line.receivedQty = "11";
    if (kind === "amount-mismatch") line.orderedAmount = "24.99";
    if (kind === "unreconciled") line.reconciliation = "Incomplete";
    if (kind === "wrong-plan") line.planId = "other-plan";
    const result = calculateJobCost(generalInput(), source);
    expect(result.generalSources[0].eligibility).toBe("Unavailable");
    expect(result.totals.directExpenses).toBeNull();
    expect(result.sourceComplete).toBe(false);
    expect(result.canFinalize).toBe(false);
  });
  it("keeps explicitly zero received distinct from unavailable and from positive received zero-rate service", () => {
    const source = facts(); source.generalSources = [{ ...general(), receivedQty: "0" }];
    const result = calculateJobCost(input(), source);
    expect(result.generalSources[0]).toMatchObject({ eligibility: "ZeroReceived", eligibleCap: "0.00", allocatedAmount: "0.00" });
    expect(result.canFinalize).toBe(true);
    source.generalSources = [{ ...general(), rate: "0", orderedAmount: "0" }];
    const draft = generalInput(); draft.generalDecisions[0].allocatedAmount = "0";
    expect(calculateJobCost(draft, source).canFinalize).toBe(true);
  });
  it.each(["general-line-1", "GeneralPOLine:general-line-1", "general-po-1", "invoice-1", "issue-1", "receipt-1", "pol-1"])("rejects manual evidenceRef %s pointing to an already sourced operand", evidenceRef => {
    const source = facts(); source.generalSources = [general()];
    const draft = generalInput();
    draft.charges = [{ id: "manual-1", head: "DirectExpense", description: "Duplicate cost", basis: "Batch", quantity: "1", rate: "1", reason: "Approved", evidenceRef }];
    expect(() => calculateJobCost(draft, source)).toThrow();
    source.generalSources[0].status = "Open";
    expect(() => calculateJobCost(draft, source)).toThrow();
  });
  it("rejects duplicate source identities and decisions for unknown source lines", () => {
    const source = facts(); source.generalSources = [general(), general()];
    expect(() => calculateJobCost(generalInput(), source)).toThrow();
    expect(() => calculateJobCost(generalInput(), facts())).toThrow();
    source.generalSources = [];
    source.materials[0].issues.push({ ...source.materials[0].issues[0] });
    expect(() => calculateJobCost(input(), source)).toThrow();
  });
});

describe("strict request and trusted-fact boundaries", () => {
  it("accepts a partial draft without inventing head decisions", () => {
    expect(parseJobCostInput({ ...input(), headDecisions: [] }).headDecisions).toEqual([]);
  });
  it.each(["capturedBy", "orgId", "sourceFingerprint", "totals", "materials", "output"])("rejects browser-supplied %s", key => {
    expect(() => parseJobCostInput({ ...input(), [key]: "spoofed" })).toThrow();
  });
  it.each(["NaN", "Infinity", "-1", "1e3", "01", " 1", "1.0000001", "1000000000"])("rejects invalid financial operand %s in requests and facts", rate => {
    const charge = { id: "c1", head: "Labour", description: "Work", basis: "LabourHours", quantity: "2", rate, reason: "Approved time", evidenceRef: "timesheet-1" };
    expect(() => parseJobCostInput({ ...input(), charges: [charge] })).toThrow();
    const source = facts();
    source.materials[0].valuation = { ...source.materials[0].valuation, rate } as JobCostFacts["materials"][number]["valuation"];
    expect(() => normalizeJobCostFacts(source)).toThrow();
  });
  it("rejects duplicate heads, charge identities and general line decisions", () => {
    const draft = input();
    expect(() => parseJobCostInput({ ...draft, headDecisions: [draft.headDecisions[0], draft.headDecisions[0]] })).toThrow();
    const charge = { id: "c1", head: "Labour", description: "Work", basis: "LabourHours", quantity: "2", rate: "1", reason: "Approved", evidenceRef: "time-1" };
    expect(() => parseJobCostInput({ ...draft, charges: [charge, charge] })).toThrow();
    const decision = { lineId: "line1", classification: "ExcludedOther", allocatedAmount: "0", basis: "Excluded", reason: "Unrelated" };
    expect(() => parseJobCostInput({ ...draft, generalDecisions: [decision, decision] })).toThrow();
  });
  it.each([
    ["Labour", "Batch", "1"], ["Labour", "PerGoodUnit", "1"], ["Labour", "MachineHours", "2"],
    ["DirectExpense", "LabourHours", "2"], ["FactoryOverhead", "Batch", "1"],
    ["Commercial", "MachineHours", "2"], ["DirectExpense", "Batch", "2"],
    ["FactoryOverhead", "PerGoodUnit", "2"], ["Labour", "PerPiece", "0"],
  ])("rejects inconsistent %s/%s quantity %s", (head, basis, quantity) => {
    expect(() => parseJobCostInput({ ...input(), charges: [{ id: "c1", head, basis, quantity, rate: "1", description: "Cost", reason: "Approved", evidenceRef: "e1" }] })).toThrow();
  });
  it("requires reasons, distinct manual evidence and cent precision on allocations", () => {
    expect(() => parseJobCostInput({ ...input(), headDecisions: [{ head: "Labour", status: "NotApplicable", reason: " " }] })).toThrow();
    const charge = { id: "c1", head: "Labour", description: "Work", basis: "LabourHours", quantity: "2", rate: "1", reason: "Approved", evidenceRef: "time-1" };
    expect(() => parseJobCostInput({ ...input(), charges: [charge, { ...charge, id: "c2" }] })).toThrow();
    expect(() => parseJobCostInput({ ...input(), generalDecisions: [{ lineId: "g1", classification: "DirectExpense", allocatedAmount: "1.001", reason: "Approved", basis: "Batch" }] })).toThrow();
  });
  it("validates calendar dates and resolves end-of-day IST without a live clock", () => {
    expect(jobCutoffInstant("2026-10-23")).toBe("2026-10-23T18:29:59.999Z");
    expect(() => jobCutoffInstant("2026-02-30")).toThrow();
    expect(() => normalizeJobCostFacts({ ...facts(), capturedAt: "2026-02-30T12:00:00.000Z" })).toThrow();
    expect(() => normalizeJobCostFacts({ ...facts(), capturedAt: "2026-10-23" })).toThrow();
  });
});

describe("recorded provisional job costing", () => {
  it("values recorded issues, never recipe requirements, and divides by completion-ledger output", () => {
    const result = calculateJobCost(input(), facts());
    expect(result.totals).toMatchObject({ material: "8.76", manufacturing: "8.76", fullCost: "8.76", perGoodUnit: "2.92" });
    expect(result.canFinalize).toBe(true);
    expect(result.valuationStatus).toBe("Provisional");
    expect(result.charges).toEqual([]);
  });
  it("keeps an approved zero distinct from a missing material rate", () => {
    const source = facts();
    if (source.materials[0].valuation.kind !== "Missing") source.materials[0].valuation.rate = "0";
    expect(calculateJobCost(input(), source).totals.fullCost).toBe("0.00");
    source.materials[0].valuation = { kind: "Missing" };
    const result = calculateJobCost(input(), source);
    expect(result.totals).toMatchObject({ knownMaterialSubtotal: "0.00", material: null, manufacturing: null, fullCost: null, perGoodUnit: null });
    expect(result.sourceComplete).toBe(true);
    expect(result.valuationComplete).toBe(false);
    expect(result.canFinalize).toBe(false);
  });
  it("preserves known material subtotals when a different SKU is unvalued", () => {
    const source = facts();
    source.materials.push({ ...source.materials[0], sku: "RM2", issues: [{ ...source.materials[0].issues[0], id: "issue-2" }], valuation: { kind: "Missing" } });
    expect(calculateJobCost(input(), source).totals).toMatchObject({ knownMaterialSubtotal: "8.76", material: null, fullCost: null });
  });
  it("does not mistake absent, empty Entered or contradictory head decisions for zero", () => {
    const draft = input();
    draft.headDecisions = draft.headDecisions.filter(d => d.head !== "Labour");
    expect(calculateJobCost(draft, facts()).totals).toMatchObject({ labour: null, manufacturing: null, fullCost: null });
    draft.headDecisions.push({ head: "Labour", status: "Entered", reason: "Approved labour" });
    expect(calculateJobCost(draft, facts()).totals.labour).toBeNull();
    draft.charges.push({ id: "c1", head: "Commercial", basis: "Batch", quantity: "1", rate: "2", description: "Delivery", reason: "Approved", evidenceRef: "delivery-1" });
    expect(calculateJobCost(draft, facts()).totals.commercial).toBeNull();
  });
  it("rounds each charge half up and separates manufacturing from Commercial", () => {
    const draft = input();
    draft.headDecisions = draft.headDecisions.map(d => ({ ...d, status: "Entered" }));
    draft.charges = [
      { id: "c1", head: "Labour", basis: "LabourHours", quantity: "1.25", rate: "2.004", description: "Hours", reason: "Approved", evidenceRef: "time-1" },
      { id: "c2", head: "DirectExpense", basis: "Batch", quantity: "1", rate: "0.005", description: "Batch", reason: "Approved", evidenceRef: "bill-1" },
      { id: "c3", head: "FactoryOverhead", basis: "PerGoodUnit", quantity: "1", rate: "0.335", description: "Allocation", reason: "Approved", evidenceRef: "pool-1" },
      { id: "c4", head: "Commercial", basis: "Batch", quantity: "1", rate: "4", description: "Delivery", reason: "Approved", evidenceRef: "delivery-1" },
    ];
    const result = calculateJobCost(draft, facts());
    expect(result.charges.map(c => c.amount)).toEqual(["2.51", "0.01", "1.01", "4.00"]);
    expect(result.charges[2].appliedQuantity).toBe("3");
    expect(result.charges[0]).toMatchObject({ approvedBy: "actor-1", approvedAt: facts().capturedAt });
    expect(result.totals).toMatchObject({ manufacturing: "12.29", fullCost: "16.29", perGoodUnit: "5.43" });
    expect(result.canFinalize).toBe(true);
  });
  it.each(["PerPiece", "LabourHours"] as const)("uses explicit %s labour quantity", basis => {
    const draft = input();
    draft.headDecisions[0].status = "Entered";
    draft.charges = [{ id: "c1", head: "Labour", basis, quantity: "5.5", rate: "2", description: "Work", reason: "Approved", evidenceRef: "work-1" }];
    expect(calculateJobCost(draft, facts()).totals.labour).toBe("11.00");
  });
  it("uses explicit machine-hour overhead without payroll or elapsed-time inference", () => {
    const draft = input();
    draft.headDecisions[2].status = "Entered";
    draft.charges = [{ id: "c1", head: "FactoryOverhead", basis: "MachineHours", quantity: "1.234567", rate: "4.123456", description: "Machine", reason: "Approved", evidenceRef: "machine-1" }];
    expect(calculateJobCost(draft, facts()).totals.factoryOverhead).toBe("5.09");
  });
  it("supports maximum accepted decimal precision without float rounding", () => {
    const source = facts();
    source.materials[0].consumedQty = "999999999.999999";
    source.materials[0].issues[0].quantity = "999999999.999999";
    if (source.materials[0].valuation.kind !== "Missing") source.materials[0].valuation.rate = "999999999.999999";
    expect(calculateJobCost(input(), source).totals.material).toBe("999999999999998000.00");
  });
  it.each(["no-output", "zero-output", "multiple-output", "fms", "wrong-uom", "wrong-sku", "wrong-reference", "wrong-source", "wrong-direction", "unreconciled", "after-cutoff", "after-capture"])("blocks %s output instead of falling back to plan start", kind => {
    const source = facts();
    if (kind === "no-output") source.output.events = [];
    if (kind === "zero-output") source.output.events[0].quantity = "0";
    if (kind === "multiple-output") source.output.events.push({ ...source.output.events[0], id: "output-2" });
    if (kind === "fms") source.output.runIds = ["run-1"];
    if (kind === "wrong-uom") source.output.events[0].uom = "kg";
    if (kind === "wrong-sku") source.output.events[0].sku = "OTHER";
    if (kind === "wrong-reference") source.output.events[0].referenceId = "other-plan";
    if (kind === "wrong-source") source.output.events[0].source = "FMS";
    if (kind === "wrong-direction") source.output.events[0].direction = "Out";
    if (kind === "unreconciled") source.output.reconciliation = "Incomplete";
    if (kind === "after-cutoff") source.output.events[0].timestamp = "2026-10-23T18:30:00.000Z";
    if (kind === "after-capture") source.output.events[0].timestamp = "2026-10-23T12:00:00.001Z";
    const result = calculateJobCost(input(), source);
    expect(result.output.quantity).toBeNull();
    expect(result.totals.perGoodUnit).toBeNull();
    expect(result.sourceComplete).toBe(false);
    expect(result.canFinalize).toBe(false);
    expect(result.diagnostics.some(d => d.blocking)).toBe(true);
  });
  it("makes only dependent per-good-unit charges unavailable when output is missing", () => {
    const source = facts(); source.output.events = [];
    const draft = input(); draft.headDecisions[2].status = "Entered";
    draft.charges = [{ id: "c1", head: "FactoryOverhead", basis: "PerGoodUnit", quantity: "1", rate: "2", description: "Pool", reason: "Approved", evidenceRef: "pool-1" }];
    const result = calculateJobCost(draft, source);
    expect(result.charges[0]).toMatchObject({ appliedQuantity: null, amount: null });
    expect(result.totals).toMatchObject({ material: "8.76", factoryOverhead: null, manufacturing: null, fullCost: null });
  });
  it.each(["Ready", "Shortage", "In_Production"] as const)("keeps %s preview incomplete", status => {
    const source = facts(); source.plan.status = status;
    expect(calculateJobCost(input(), source).canFinalize).toBe(false);
  });
  it("rejects cancelled or mismatched plan requests", () => {
    const source = facts(); source.plan.status = "Cancelled";
    expect(() => calculateJobCost(input(), source)).toThrow();
    expect(() => calculateJobCost({ ...input(), planId: "other" }, facts())).toThrow();
  });
  it.each(["consumed-mismatch", "missing-consumed", "missing-issue", "zero-issue", "multiple-issue", "unreconciled", "after-cutoff", "future-start", "missing-start", "future-rate", "wrong-rate-uom"])("does not value %s material evidence", kind => {
    const source = facts(); const material = source.materials[0];
    if (kind === "consumed-mismatch") material.consumedQty = "2";
    if (kind === "missing-consumed") material.consumedQty = null;
    if (kind === "missing-issue") material.issues = [];
    if (kind === "zero-issue") material.issues[0].quantity = "0";
    if (kind === "multiple-issue") material.issues.push({ ...material.issues[0], id: "issue-2" });
    if (kind === "unreconciled") material.reconciliation = "Incomplete";
    if (kind === "after-cutoff") material.issues[0].timestamp = "2026-10-24T05:00:00.000Z";
    if (kind === "future-start") source.plan.startedAt = "2026-10-24T05:00:00.000Z";
    if (kind === "missing-start") source.plan.startedAt = null;
    if (kind === "future-rate" && material.valuation.kind !== "Missing") material.valuation.date = "2026-10-22T05:00:00.001Z";
    if (kind === "wrong-rate-uom" && material.valuation.kind !== "Missing") material.valuation.uom = "pcs";
    const result = calculateJobCost(input(), source);
    expect(result.materials[0].amount).toBeNull();
    expect(result.totals.material).toBeNull();
    expect(result.canFinalize).toBe(false);
  });
  it("uses issue IST calendar date for standards and discloses retrospective approval", () => {
    const source = facts();
    source.materials[0].issues[0].timestamp = "2026-10-21T19:00:00.000Z";
    source.plan.startedAt = "2026-10-21T19:00:00.000Z";
    source.materials[0].valuation = { kind: "ApprovedStandardProvisional", rate: "4.12", currency: "INR", uom: "kg", date: "2026-10-22", standardId: "standard-1", approvedBy: "approver", approvedAt: "2026-10-23T06:00:00.000Z", reason: "Explicit standard approval" };
    const result = calculateJobCost(input(), source);
    expect(result.totals.material).toBe("8.76");
    expect(result.canFinalize).toBe(true);
    expect(result.diagnostics.some(d => d.code === "RETROSPECTIVE_STANDARD" && !d.blocking)).toBe(true);
    source.materials[0].valuation.date = "2026-10-23";
    expect(calculateJobCost(input(), source).totals.material).toBeNull();
  });
  it("propagates server diagnostics and does not mutate input or evidence", () => {
    const source = facts(); source.diagnostics = [{ code: "NONCANONICAL_MOVEMENT", blocking: true, sourceIds: ["return-1"], message: "Unreconciled movement" }];
    const before = JSON.stringify(source), draft = input(), draftBefore = JSON.stringify(draft);
    const result = calculateJobCost(draft, source);
    expect(result.sourceComplete).toBe(false);
    expect(result.canFinalize).toBe(false);
    result.plan.productName = "Changed";
    result.input.asOfDate = "2026-10-24";
    expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(draft)).toBe(draftBefore);
  });
  it("validates facts and requests even when called directly rather than through HTTP", () => {
    expect(() => calculateJobCost({ ...input(), orgId: "spoofed" } as JobCostInput, facts())).toThrow();
    const source = facts(); source.materials[0].issues[0].quantity = "NaN";
    expect(() => calculateJobCost(input(), source)).toThrow();
  });
});
