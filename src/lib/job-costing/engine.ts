import { CostingError, SCALE, money, quantity, round, units } from "@/lib/costing/validation";
import { jobCutoffInstant, normalizeJobCostFacts, parseJobCostInput } from "./validation";
import type { CostHead, JobCostCalculation, JobCostFacts, JobCostInput, JobGeneralSourceFact, JobMaterialFact, JobOutputFact } from "./types";

const ZERO = BigInt(0);
const HEADS: CostHead[] = ["Labour", "DirectExpense", "FactoryOverhead", "Commercial"];
const GENERAL_HEADS: CostHead[] = ["DirectExpense", "FactoryOverhead", "Commercial"];
// Stable English evidence metadata, not viewer-localized presentation copy.
const OUTPUT_CAVEAT = "Completion ledger quantity repeats start/fallback quantity; not independently measured or QC-accepted good output.";
const LIMITATIONS = [
  "Recorded job cost is a provisional INR management valuation, not historical FIFO/WAC or proven actual cost.",
  "Production issues are BOM-derived recorded stock movements, not independently measured consumption. Stock SKU leaves are not exploded.",
  OUTPUT_CAVEAT,
  "Unlinked Manual/Adjustment movements cannot reliably be attributed to this job; their absence is not certified.",
  "Recoverable taxes are excluded. No automatic GL posting, stock revaluation, payroll/TAT allocation, depreciation or margin calculation.",
  "Current plan state is captured, not reconstructed historical workflow state. Preview allocations do not reserve source caps.",
  "General PO receipt evidence uses one header completion time, not append-only line acceptance events.",
];
function lineCents(q: bigint, rate: string): bigint { return round(q * units(rate) * BigInt(100), SCALE * SCALE); }
function centsOf(decimalCents: string): bigint { return units(decimalCents) / (SCALE / BigInt(100)); }
function istDate(instant: string): string { return new Date(Date.parse(instant) + 330 * 60 * 1000).toISOString().slice(0, 10); }

/** Pure deterministic calculation over internally captured evidence. No source fetches or approvals are performed.
 * The adapter must supply complete normalized operands and blocking diagnostics for unresolved joins/movements. */
export function calculateJobCost(raw: JobCostInput, rawFacts: JobCostFacts): JobCostCalculation {
  const input = parseJobCostInput(raw), facts = normalizeJobCostFacts(rawFacts);
  if (facts.plan.planId !== input.planId) throw new CostingError("Plan identity mismatch");
  if (facts.plan.status === "Cancelled") throw new CostingError("Cancelled plans cannot create job cost sheets");
  for (const decision of input.generalDecisions) {
    if (!facts.generalSources.some(line => line.lineId === decision.lineId)) throw new CostingError(`Unknown General PO line ${decision.lineId}`);
  }
  const sourcedEvidenceIds = new Set<string>();
  for (const material of facts.materials) {
    for (const issue of material.issues) sourcedEvidenceIds.add(issue.id);
    const valuation = material.valuation;
    if (valuation.kind === "PurchaseAgreedProvisional") { sourcedEvidenceIds.add(valuation.poId); sourcedEvidenceIds.add(valuation.lineId); sourcedEvidenceIds.add(valuation.indentId); sourcedEvidenceIds.add(valuation.receiptId); }
    if (valuation.kind === "ApprovedStandardProvisional") sourcedEvidenceIds.add(valuation.standardId);
  }
  for (const line of facts.generalSources) { sourcedEvidenceIds.add(line.lineId); sourcedEvidenceIds.add(`GeneralPOLine:${line.lineId}`); sourcedEvidenceIds.add(line.poId); for (const ref of line.evidenceRefs) sourcedEvidenceIds.add(ref); }
  for (const charge of input.charges) {
    if (sourcedEvidenceIds.has(charge.evidenceRef)) throw new CostingError(`Manual evidence ${charge.evidenceRef} duplicates an already-sourced operand`);
  }

  const diagnostics = facts.diagnostics;
  let sourceComplete = !diagnostics.some(d => d.blocking);
  const add = (code: string, sourceIds: string[], message: string, blocking = true) => diagnostics.push({ code, blocking, sourceIds, message });
  const cutoff = Date.parse(jobCutoffInstant(input.asOfDate));
  const capture = Date.parse(facts.capturedAt);
  const throughCapture = (instant: string) => Date.parse(instant) <= capture;
  const throughCutoff = (instant: string) => Date.parse(instant) <= cutoff && throughCapture(instant);
  const started = facts.plan.startedAt;
  const startValid = started !== null && throughCutoff(started);
  if (!startValid) { sourceComplete = false; add("START_UNAVAILABLE", [input.planId], "Production start is missing or later than cutoff/capture."); }

  const event = facts.output.events[0];
  const outputValid = facts.plan.status === "Completed" && startValid && facts.output.reconciliation === "Reconciled"
    && facts.output.runIds.length === 0 && facts.output.events.length === 1 && event
    && units(event.quantity) > ZERO && event.sku === facts.plan.productSku && event.uom === facts.plan.productUom
    && event.referenceId === input.planId && event.source === "Production_Output" && event.direction === "In"
    && throughCutoff(event.timestamp) && Date.parse(event.timestamp) >= Date.parse(started!);
  const output: JobOutputFact = {
    quantity: outputValid ? quantity(units(event.quantity)) : null, uom: outputValid ? event.uom : null,
    basis: outputValid ? "CompletionLedger" : "Unavailable", ledgerIds: facts.output.events.map(e => e.id),
    runIds: facts.output.runIds, timestamp: outputValid ? event.timestamp : null, caveat: OUTPUT_CAVEAT,
  };
  if (!outputValid) {
    sourceComplete = false;
    add(facts.output.runIds.length ? "FMS_OUTPUT_UNSUPPORTED" : "OUTPUT_UNAVAILABLE", [...output.ledgerIds, ...output.runIds], "Exactly one reconciled positive non-FMS completed-plan output is required.");
  }
  let knownMaterial = ZERO, materialComplete = facts.materials.length > 0;
  if (!materialComplete) { sourceComplete = false; add("MATERIALS_UNAVAILABLE", [input.planId], "No normalized plan-material evidence was supplied."); }
  const materials: JobMaterialFact[] = facts.materials.map(material => {
    const issue = material.issues[0];
    const reconciled = startValid && material.reconciliation === "Reconciled" && material.consumedQty !== null
      && material.issues.length === 1 && issue && units(issue.quantity) > ZERO
      && units(issue.quantity) === units(material.consumedQty) && throughCutoff(issue.timestamp)
      && Date.parse(issue.timestamp) >= Date.parse(started!);
    let amount: string | null = null;
    if (!reconciled) {
      sourceComplete = false;
      add("MATERIAL_UNRECONCILED", [material.sku, ...material.issues.map(i => i.id)], "Recorded issues do not reconcile with consumed quantity, start or cutoff.");
    } else {
      const valuation = material.valuation;
      const compatible = valuation.kind !== "Missing" && valuation.uom === material.uom
        && (valuation.kind === "PurchaseAgreedProvisional" ? Date.parse(valuation.date) <= Date.parse(issue.timestamp)
          : valuation.date <= istDate(issue.timestamp) && throughCapture(valuation.approvedAt));
      if (compatible) {
        const cents = lineCents(units(issue.quantity), valuation.rate);
        knownMaterial += cents; amount = money(cents);
        if (valuation.kind === "ApprovedStandardProvisional" && Date.parse(valuation.approvedAt) > Date.parse(issue.timestamp)) {
          add("RETROSPECTIVE_STANDARD", [issue.id, valuation.standardId], "Standard approval was recorded after issue; valuation remains provisional.", false);
        }
      } else add("MATERIAL_RATE_UNAVAILABLE", [material.sku, issue.id], "No compatible issue-date provisional rate is available.");
    }
    if (amount === null) materialComplete = false;
    return { ...material, issuedQuantity: reconciled ? quantity(units(issue.quantity)) : null, amount };
  });

  const sums: Record<CostHead, bigint> = { Labour: ZERO, DirectExpense: ZERO, FactoryOverhead: ZERO, Commercial: ZERO };
  const blockedHeads = new Set<CostHead>();
  const generalSources: JobGeneralSourceFact[] = facts.generalSources.map(line => {
    const decision = input.generalDecisions.find(d => d.lineId === line.lineId) ?? null;
    const malformed = line.reconciliation !== "Reconciled" || line.planId !== input.planId || line.status === "Completed" && (
      line.receivedQty === null || line.receivedAt === null || line.receivedBy === null
      || units(line.receivedQty) > units(line.orderedQty)
      || lineCents(units(line.orderedQty), line.rate) !== centsOf(line.orderedAmount)
    );
    let eligibility: JobGeneralSourceFact["eligibility"];
    if (line.status !== "Completed") eligibility = "Committed";
    else if (malformed) eligibility = "Unavailable";
    else if (line.receivedAt! && !throughCutoff(line.receivedAt!)) eligibility = "Committed";
    else if (units(line.receivedQty!) === ZERO) eligibility = "ZeroReceived";
    else eligibility = "Eligible";

    let eligibleCap: string | null = null, allocatedAmount: string | null = null;
    if (eligibility === "Eligible" || eligibility === "ZeroReceived") {
      const capCents = eligibility === "ZeroReceived" ? ZERO : lineCents(units(line.receivedQty!), line.rate) < centsOf(line.orderedAmount)
        ? lineCents(units(line.receivedQty!), line.rate) : centsOf(line.orderedAmount);
      eligibleCap = money(capCents);
      if (!decision) {
        if (eligibility === "Eligible") {
          sourceComplete = false;
          add("GENERAL_LINE_UNCLASSIFIED", [line.lineId], "Eligible received General PO line requires explicit classification before finalization.");
          GENERAL_HEADS.forEach(h => blockedHeads.add(h));
        } else allocatedAmount = "0.00";
      } else if (decision.classification.startsWith("Excluded")) {
        allocatedAmount = "0.00";
      } else {
        const head = decision.classification as CostHead;
        const allocCents = centsOf(decision.allocatedAmount);
        const remaining = capCents - centsOf(line.activeAllocatedAmount);
        if (remaining < ZERO || allocCents > remaining) {
          sourceComplete = false; blockedHeads.add(head);
          add("GENERAL_ALLOCATION_EXCEEDS_CAP", [line.lineId], "Allocation exceeds the eligible cap net of other active claims; it is rejected, not clamped.");
        } else { allocatedAmount = money(allocCents); sums[head] += allocCents; }
      }
    } else {
      if (eligibility === "Unavailable") { sourceComplete = false; add("GENERAL_LINE_UNAVAILABLE", [line.lineId], "General PO line receipt evidence is malformed, overreceived or unlinked to this plan."); }
      if (decision) {
        sourceComplete = false;
        if (!decision.classification.startsWith("Excluded")) blockedHeads.add(decision.classification as CostHead);
        add("GENERAL_DECISION_ON_INELIGIBLE_SOURCE", [line.lineId], "A classification decision requires an eligible received line; committed/unavailable sources cannot be charged.");
      } else allocatedAmount = "0.00";
    }
    return { ...line, eligibility, eligibleCap, decision, allocatedAmount };
  });

  const charges = input.charges.map(charge => {
    const q = charge.basis === "PerGoodUnit" ? (output.quantity === null ? null : units(output.quantity))
      : charge.basis === "Batch" ? SCALE : units(charge.quantity);
    const cents = q === null ? null : lineCents(q, charge.rate);
    if (cents === null) { blockedHeads.add(charge.head); add("CHARGE_OUTPUT_UNAVAILABLE", [charge.id], "Per-good-unit charge requires admitted output."); }
    else sums[charge.head] += cents;
    return { ...charge, appliedQuantity: q === null ? null : quantity(q), amount: cents === null ? null : money(cents), approvedBy: facts.capturedBy, approvedAt: facts.capturedAt };
  });
  const headComplete: Record<CostHead, boolean> = { Labour: true, DirectExpense: true, FactoryOverhead: true, Commercial: true };
  for (const head of HEADS) {
    const decision = input.headDecisions.find(d => d.head === head);
    const count = input.charges.filter(c => c.head === head).length + input.generalDecisions.filter(d => d.classification === head).length;
    if (!decision || (decision.status === "Entered" ? count === 0 : count > 0)) {
      headComplete[head] = false;
      add("HEAD_UNDECIDED_OR_CONFLICTING", [head], "Head requires consistent Entered evidence or reasoned NotApplicable.");
    }
    if (blockedHeads.has(head)) headComplete[head] = false;
  }
  const headTotal = (head: CostHead) => headComplete[head] ? money(sums[head]) : null;
  const manufacturingCents = knownMaterial + sums.Labour + sums.DirectExpense + sums.FactoryOverhead;
  const manufacturingComplete = materialComplete && headComplete.Labour && headComplete.DirectExpense && headComplete.FactoryOverhead;
  const fullComplete = manufacturingComplete && headComplete.Commercial;
  const fullCents = manufacturingCents + sums.Commercial;
  const valuationComplete = materialComplete && HEADS.every(h => headComplete[h]);
  const canFinalize = sourceComplete && valuationComplete && !diagnostics.some(d => d.blocking);
  return {
    input, capturedAt: facts.capturedAt, capturedBy: facts.capturedBy, sourceFingerprint: facts.sourceFingerprint,
    plan: facts.plan, materials, output, generalSources, charges,
    totals: {
      knownMaterialSubtotal: money(knownMaterial), knownLabourSubtotal: money(sums.Labour),
      knownDirectExpensesSubtotal: money(sums.DirectExpense), knownFactoryOverheadSubtotal: money(sums.FactoryOverhead), knownCommercialSubtotal: money(sums.Commercial),
      material: materialComplete ? money(knownMaterial) : null, labour: headTotal("Labour"), directExpenses: headTotal("DirectExpense"), factoryOverhead: headTotal("FactoryOverhead"),
      manufacturing: manufacturingComplete ? money(manufacturingCents) : null, commercial: headTotal("Commercial"), fullCost: fullComplete ? money(fullCents) : null,
      perGoodUnit: fullComplete && output.quantity !== null ? money(round(fullCents * SCALE, units(output.quantity))) : null,
    },
    sourceComplete, valuationComplete, canFinalize, valuationStatus: canFinalize ? "Provisional" : "Incomplete", limitations: [...LIMITATIONS], diagnostics,
  };
}
