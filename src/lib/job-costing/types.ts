/** Client-safe recorded-basis DTOs. All financial operands are decimal strings.
 * Facts are server-owned normalized evidence, never browser request fields. */
import type { CostHead } from "@/lib/costing/types";
export type { CostHead } from "@/lib/costing/types";

export type JobCostBasis = "Batch" | "PerGoodUnit" | "LabourHours" | "MachineHours" | "PerPiece";
export type JobGeneralClassification = "DirectExpense" | "FactoryOverhead" | "Commercial" | "ExcludedCapital" | "ExcludedOther";
export interface JobHeadDecision { head: CostHead; status: "Entered" | "NotApplicable"; reason: string }
export interface JobChargeInput {
  id: string; head: CostHead; description: string; basis: JobCostBasis;
  /** Batch and PerGoodUnit require the sentinel 1; output determines PerGoodUnit. */
  quantity: string; rate: string; reason: string; evidenceRef: string;
}
export interface JobGeneralDecision {
  lineId: string; classification: JobGeneralClassification; allocatedAmount: string; basis: string; reason: string;
}
export interface JobCostInput {
  planId: string; asOfDate: string; headDecisions: JobHeadDecision[];
  charges: JobChargeInput[]; generalDecisions: JobGeneralDecision[];
}
export interface JobDiagnostic { code: string; blocking: boolean; sourceIds: string[]; message: string }
export interface JobPlanFact {
  planId: string; jobNo: string; productSku: string; productName: string; productUom: string;
  bomId: string; bomVersion: string;
  /** Widened (J3, frozen) to the real `productionPlans.status` enum exactly — no collapsing
   * of Ready/Shortage into a synthetic "Planned" value. See `source.ts`'s former
   * `mapPlanStatus`, now an identity pass-through. */
  status: "Ready" | "Shortage" | "In_Production" | "Completed" | "Cancelled";
  startedAt: string | null;
}
export interface JobIssueFact { id: string; timestamp: string; quantity: string; userId: string }
export type JobMaterialValuation =
  | { kind: "Missing" }
  | { kind: "PurchaseAgreedProvisional"; rate: string; uom: string; currency: "INR"; date: string;
      poId: string; lineId: string; indentId: string; receiptId: string }
  | { kind: "ApprovedStandardProvisional"; rate: string; uom: string; currency: "INR"; date: string;
      standardId: string; approvedBy: string; approvedAt: string; reason: string };
export interface JobMaterialEvidence {
  sku: string; name: string; uom: string; requiredQty: string | null; consumedQty: string | null;
  /** Adapter reconciles exact tenant/plan/SKU/UOM and all noncanonical movements. */
  reconciliation: "Reconciled" | "Incomplete"; issues: JobIssueFact[]; valuation: JobMaterialValuation;
}
export interface JobMaterialFact extends JobMaterialEvidence {
  issuedQuantity: string | null; amount: string | null;
}
export interface JobOutputEvent extends JobIssueFact {
  sku: string; uom: string; referenceId: string; source: string; direction: "In" | "Out";
}
export interface JobOutputEvidence {
  reconciliation: "Reconciled" | "Incomplete"; runIds: string[]; events: JobOutputEvent[];
}
export interface JobOutputFact {
  quantity: string | null; uom: string | null; basis: "CompletionLedger" | "Unavailable";
  ledgerIds: string[]; runIds: string[]; timestamp: string | null; caveat: string;
}
export interface JobGeneralSourceEvidence {
  poId: string; lineId: string; planId: string; status: "Open" | "Completed" | "Cancelled";
  orderedQty: string; receivedQty: string | null; receivedAt: string | null; receivedBy: string | null;
  uom: string; rate: string; orderedAmount: string; sourceFingerprint: string;
  /** Claims of other active sheets, excluding only an explicitly superseded parent (J4). */
  activeAllocatedAmount: string;
  reconciliation: "Reconciled" | "Incomplete";
  /** Canonical aliases (PO/line/invoice etc.) forbidden as manual-charge evidence. */
  evidenceRefs: string[];
}
export interface JobGeneralSourceFact extends JobGeneralSourceEvidence {
  eligibility: "Eligible" | "Committed" | "Unavailable" | "ZeroReceived";
  eligibleCap: string | null; decision: JobGeneralDecision | null; allocatedAmount: string | null;
}
export interface ApprovedJobCharge extends JobChargeInput {
  appliedQuantity: string | null; amount: string | null; approvedBy: string; approvedAt: string;
}
export interface JobCostFacts {
  orgId: string; capturedAt: string; capturedBy: string; sourceFingerprint: string;
  plan: JobPlanFact; materials: JobMaterialEvidence[]; output: JobOutputEvidence;
  generalSources: JobGeneralSourceEvidence[]; diagnostics: JobDiagnostic[];
}
export interface JobCostTotals {
  knownMaterialSubtotal: string; knownLabourSubtotal: string; knownDirectExpensesSubtotal: string;
  knownFactoryOverheadSubtotal: string; knownCommercialSubtotal: string;
  material: string | null; labour: string | null; directExpenses: string | null;
  factoryOverhead: string | null; manufacturing: string | null; commercial: string | null;
  fullCost: string | null; perGoodUnit: string | null;
}
export interface JobCostCalculation {
  input: JobCostInput; capturedAt: string; capturedBy: string; sourceFingerprint: string;
  plan: JobPlanFact; materials: JobMaterialFact[]; output: JobOutputFact;
  generalSources: JobGeneralSourceFact[]; charges: ApprovedJobCharge[]; totals: JobCostTotals;
  sourceComplete: boolean; valuationComplete: boolean; canFinalize: boolean;
  valuationStatus: "Provisional" | "Incomplete"; limitations: string[]; diagnostics: JobDiagnostic[];
}
export interface JobCostSheet {
  id: string; planId: string; productSku: string; revision: number; version: number;
  status: "Draft" | "Finalized"; supersedesId: string | null; calculation: JobCostCalculation;
  createdBy: string; createdAt: string; updatedAt: string; finalizedBy: string | null; finalizedAt: string | null;
}
