/**
 * J5 — client-side readback validation for Recorded Job Cost Sheets. Mirrors
 * `src/lib/costing/readback.ts`'s intent (structural type-guard + identity comparison on
 * a mutation response, before the controller trusts it as the new saved snapshot) without
 * importing anything from `src/lib/costing/*`.
 *
 * Deliberately NOT a full zod re-parse of `JobCostCalculation` (that shape is large and
 * server-owned already — see `validation.ts`'s `jobCostFactsSchema`). This only guards the
 * handful of invariants the controller actually depends on: identity fields exist and are
 * well-typed, and a Finalized sheet is never missing its finalize metadata/canFinalize flag.
 */
import type { JobCostSheet } from "./types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validJobCostSnapshot(value: unknown): value is JobCostSheet {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  if (!isNonEmptyString(s.id) || !isNonEmptyString(s.planId) || !isNonEmptyString(s.productSku)) return false;
  if (typeof s.revision !== "number" || !Number.isInteger(s.revision) || s.revision <= 0) return false;
  if (typeof s.version !== "number" || !Number.isInteger(s.version) || s.version <= 0) return false;
  if (s.status !== "Draft" && s.status !== "Finalized") return false;
  if (s.supersedesId !== null && !isNonEmptyString(s.supersedesId)) return false;
  if (!isTimestamp(s.createdAt) || !isNonEmptyString(s.createdBy) || !isTimestamp(s.updatedAt)) return false;
  if (!s.calculation || typeof s.calculation !== "object") return false;
  const c = s.calculation as Record<string, unknown>;
  if (!isNonEmptyString(c.sourceFingerprint)) return false;
  if (typeof c.sourceComplete !== "boolean" || typeof c.valuationComplete !== "boolean" || typeof c.canFinalize !== "boolean") return false;
  const plan = c.plan as Record<string, unknown> | undefined;
  if (!plan || plan.planId !== s.planId || plan.productSku !== s.productSku) return false;
  if (s.status === "Draft") {
    return s.finalizedAt === null && s.finalizedBy === null;
  }
  return isTimestamp(s.finalizedAt) && isNonEmptyString(s.finalizedBy) && c.canFinalize === true;
}

export function sameJobCostIdentity(a: JobCostSheet, b: JobCostSheet): boolean {
  return a.id === b.id && a.planId === b.planId && a.productSku === b.productSku
    && a.revision === b.revision && a.supersedesId === b.supersedesId
    && a.createdAt === b.createdAt && a.createdBy === b.createdBy;
}

/** Generic structural deep-equal — JSONB does not preserve object-key insertion order, and
 * array order/values matter. Kept local (not imported from `costing/client`) so this module
 * has no dependency on the estimated feature's code. */
export function jobCostDataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => jobCostDataEqual(value, b[i]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && jobCostDataEqual(left[key], right[key]));
}
