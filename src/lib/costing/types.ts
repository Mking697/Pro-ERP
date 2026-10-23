/** Shared serializable Cost Sheet contract. Decimal values cross the API as strings.
 * This module must stay free of database/server imports for client and export reuse. */
export type CostHead = "Labour" | "DirectExpense" | "FactoryOverhead" | "Commercial";
export type CostBasis = "Batch" | "PerUnit" | "LabourHours" | "MachineHours";
export interface CostChargeInput {
  head: CostHead;
  description: string;
  basis: CostBasis;
  /** Used only for hour-based charges; Batch uses 1 and PerUnit uses sheet batchQty. */
  quantity: string;
  rate: string;
}
export interface CostSheetInput {
  productSku: string;
  batchQty: string;
  asOfDate: string;
  charges: CostChargeInput[];
}
export interface CostRateSource {
  kind: "Purchase" | "Standard" | "Missing";
  id: string;
  date: string;
  description: string;
}
export interface CostMaterial {
  sku: string;
  name: string;
  uom: string;
  qtyPerUnit: string;
  requiredQty: string;
  rate: string | null;
  amount: string | null;
  source: CostRateSource;
}
export interface CostCharge extends CostChargeInput {
  appliedQuantity: string;
  amount: string;
}
export interface CostTotals {
  knownMaterialSubtotal: string;
  material: string | null;
  labour: string;
  directExpenses: string;
  factoryOverhead: string;
  manufacturing: string | null;
  commercial: string;
  fullCost: string | null;
  perUnit: string | null;
}
export interface CostCalculation {
  productSku: string;
  productName: string;
  productUom: string;
  bomId: string;
  bomVersion: string;
  input: CostSheetInput;
  materials: CostMaterial[];
  charges: CostCharge[];
  totals: CostTotals;
  complete: boolean;
  /** Stable warning codes or descriptive source messages; never invent missing amounts. */
  warnings: string[];
}
export interface CostSheet {
  id: string;
  productSku: string;
  productName: string;
  revision: number;
  status: "Draft" | "Finalized";
  /** Optimistic concurrency token, incremented on each successful draft update/finalize. */
  version: number;
  calculation: CostCalculation;
  supersedesId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
}
export interface CostSheetSummary {
  id: string;
  productSku: string;
  productName: string;
  revision: number;
  status: "Draft" | "Finalized";
  version: number;
  asOfDate: string;
  batchQty: string;
  totalCost: string | null;
  createdAt: string;
}
export interface CostProduct {
  sku: string;
  name: string;
  uom: string;
  bomId: string | null;
  bomVersion: string | null;
}
export interface StandardCostRateInput {
  sku: string;
  uom: string;
  rate: string;
  effectiveDate: string;
  reason: string;
}
export interface StandardCostRate extends StandardCostRateInput {
  id: string;
  approvedBy: string;
  approvedAt: string;
}
