import { describe, expect, it } from "vitest";
import { jobCostDataEqual, sameJobCostIdentity, validJobCostSnapshot } from "@/lib/job-costing/readback";
import type { JobCostSheet } from "@/lib/job-costing/types";

function baseCalculation(overrides: Partial<JobCostSheet["calculation"]> = {}): JobCostSheet["calculation"] {
  return {
    input: { planId: "PLN-1", asOfDate: "2026-10-01", headDecisions: [], charges: [], generalDecisions: [] },
    capturedAt: "2026-10-01T12:00:00.000Z",
    capturedBy: "user-1",
    sourceFingerprint: "fp-1",
    plan: {
      planId: "PLN-1", jobNo: "JOB-1", productSku: "SKU-1", productName: "Widget", productUom: "PCS",
      bomId: "BOM-1", bomVersion: "1", status: "Completed", startedAt: "2026-09-30T00:00:00.000Z",
    },
    materials: [],
    output: { quantity: null, uom: null, basis: "Unavailable", ledgerIds: [], runIds: [], timestamp: null, caveat: "caveat" },
    generalSources: [],
    charges: [],
    totals: {
      knownMaterialSubtotal: "0.00", knownLabourSubtotal: "0.00", knownDirectExpensesSubtotal: "0.00",
      knownFactoryOverheadSubtotal: "0.00", knownCommercialSubtotal: "0.00",
      material: null, labour: null, directExpenses: null, factoryOverhead: null, manufacturing: null,
      commercial: null, fullCost: null, perGoodUnit: null,
    },
    sourceComplete: false, valuationComplete: false, canFinalize: false,
    valuationStatus: "Incomplete", limitations: [], diagnostics: [],
    ...overrides,
  };
}

function draftSheet(overrides: Partial<JobCostSheet> = {}): JobCostSheet {
  return {
    id: "JCS-1", planId: "PLN-1", productSku: "SKU-1", revision: 1, version: 1, status: "Draft",
    supersedesId: null, calculation: baseCalculation(),
    createdBy: "user-1", createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
    finalizedBy: null, finalizedAt: null,
    ...overrides,
  };
}

function finalizedSheet(overrides: Partial<JobCostSheet> = {}): JobCostSheet {
  return draftSheet({
    status: "Finalized", version: 2, finalizedBy: "user-1", finalizedAt: "2026-10-02T12:00:00.000Z",
    calculation: baseCalculation({ sourceComplete: true, valuationComplete: true, canFinalize: true, valuationStatus: "Provisional" }),
    ...overrides,
  });
}

describe("validJobCostSnapshot", () => {
  it("accepts a well-formed Draft sheet", () => {
    expect(validJobCostSnapshot(draftSheet())).toBe(true);
  });

  it("accepts a well-formed Finalized sheet", () => {
    expect(validJobCostSnapshot(finalizedSheet())).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(validJobCostSnapshot(null)).toBe(false);
    expect(validJobCostSnapshot("sheet")).toBe(false);
    expect(validJobCostSnapshot(42)).toBe(false);
  });

  it("rejects a Draft carrying finalize metadata", () => {
    expect(validJobCostSnapshot(draftSheet({ finalizedAt: "2026-10-02T12:00:00.000Z" }))).toBe(false);
    expect(validJobCostSnapshot(draftSheet({ finalizedBy: "user-1" }))).toBe(false);
  });

  it("rejects a Finalized sheet missing finalize metadata", () => {
    expect(validJobCostSnapshot(finalizedSheet({ finalizedAt: null }))).toBe(false);
    expect(validJobCostSnapshot(finalizedSheet({ finalizedBy: null }))).toBe(false);
  });

  it("rejects a Finalized sheet whose calculation is not canFinalize", () => {
    expect(validJobCostSnapshot(finalizedSheet({ calculation: baseCalculation({ sourceComplete: true, valuationComplete: true, canFinalize: false }) }))).toBe(false);
  });

  it("rejects a non-positive revision or version", () => {
    expect(validJobCostSnapshot(draftSheet({ revision: 0 }))).toBe(false);
    expect(validJobCostSnapshot(draftSheet({ version: -1 }))).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(validJobCostSnapshot({ ...draftSheet(), status: "Pending" })).toBe(false);
  });

  it("rejects when the calculation's plan identity does not match the sheet", () => {
    const sheet = draftSheet();
    const mismatched = { ...sheet, calculation: { ...sheet.calculation, plan: { ...sheet.calculation.plan, planId: "PLN-OTHER" } } };
    expect(validJobCostSnapshot(mismatched)).toBe(false);
  });

  it("rejects a non-timestamp createdAt/updatedAt", () => {
    expect(validJobCostSnapshot(draftSheet({ createdAt: "not-a-date" }))).toBe(false);
    expect(validJobCostSnapshot(draftSheet({ updatedAt: "not-a-date" }))).toBe(false);
  });
});

describe("sameJobCostIdentity", () => {
  it("is true for the same sheet's identity fields", () => {
    const sheet = draftSheet();
    expect(sameJobCostIdentity(sheet, { ...sheet })).toBe(true);
  });

  it("is false when any identity field differs", () => {
    const sheet = draftSheet();
    expect(sameJobCostIdentity(sheet, { ...sheet, id: "JCS-2" })).toBe(false);
    expect(sameJobCostIdentity(sheet, { ...sheet, planId: "PLN-2" })).toBe(false);
    expect(sameJobCostIdentity(sheet, { ...sheet, productSku: "SKU-2" })).toBe(false);
    expect(sameJobCostIdentity(sheet, { ...sheet, revision: 2 })).toBe(false);
    expect(sameJobCostIdentity(sheet, { ...sheet, supersedesId: "JCS-0" })).toBe(false);
    expect(sameJobCostIdentity(sheet, { ...sheet, createdAt: "2026-10-05T00:00:00.000Z" })).toBe(false);
    expect(sameJobCostIdentity(sheet, { ...sheet, createdBy: "user-2" })).toBe(false);
  });

  it("is true across a version bump that keeps identity fields stable", () => {
    const sheet = draftSheet();
    expect(sameJobCostIdentity(sheet, { ...sheet, version: 2, updatedAt: "2026-10-03T00:00:00.000Z" })).toBe(true);
  });
});

describe("jobCostDataEqual", () => {
  it("treats array order as significant (JSONB does not preserve key order but arrays do)", () => {
    expect(jobCostDataEqual([1, 2], [2, 1])).toBe(false);
    expect(jobCostDataEqual([1, 2], [1, 2])).toBe(true);
  });

  it("ignores object key order", () => {
    expect(jobCostDataEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("is a deep comparison", () => {
    expect(jobCostDataEqual(draftSheet(), draftSheet())).toBe(true);
    expect(jobCostDataEqual(draftSheet(), draftSheet({ revision: 2 }))).toBe(false);
  });

  it("distinguishes null/object/array/primitive mismatches", () => {
    expect(jobCostDataEqual(null, {})).toBe(false);
    expect(jobCostDataEqual({}, [])).toBe(false);
    expect(jobCostDataEqual(1, "1")).toBe(false);
    expect(jobCostDataEqual(null, null)).toBe(true);
  });
});
