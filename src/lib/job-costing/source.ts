/**
 * J2 — read-only source adapter for Recorded Job Cost Sheets.
 *
 * Assembles the exact `JobCostFacts` shape the J1 engine (`./engine.ts`) consumes, from
 * the real writers identified in `docs/job-cost-sheet-implementation.md` section 2:
 * `src/lib/inventory/plans.ts` (startProduction/completePlan), `src/db/schema/ppc.ts`
 * (productionPlans/planMaterials), `src/db/schema/inventory.ts` (stockLedger),
 * `src/lib/purchase/generalOrders.ts` (receiveGeneralPurchaseOrder) and the
 * `src/lib/costing/service.ts` indent/PO/receipt join pattern for issue-date rate
 * provenance. `src/lib/fms/engine.ts`'s `hasFmsLine` identity (fms_runs.contextRef =
 * `PRODUCTION_PLANS:<planId>`) is mirrored for exclusion, not reimported, to avoid the
 * same plans<->fms circular-import shape that file's own comment documents.
 *
 * All real data access is behind the injected `JobSourceStore` — every method is a plain
 * read-only select through existing schema/columns, never raw SQL, and the production
 * implementation (`createDbJobSourceStore`) is tenant-scoped by construction (every query
 * takes the resolved `orgId` as an explicit parameter, never trusts a caller-supplied one
 * without a prior tenant resolution). Composition (`buildJobCostFacts`) is pure and
 * DB-free, so it is exercised directly against fixtures in
 * `tests/job-costing-source.test.ts` without touching a real database.
 *
 * No schema changes, no HTTP routes, no persistence and no finalize/allocation logic
 * live here — this stage only produces normalized evidence and diagnostics for J1's
 * `calculateJobCost` to validate and total.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { decimal, money, quantity, round, SCALE, units } from "@/lib/costing/validation";
import type {
  JobCostFacts,
  JobDiagnostic,
  JobGeneralSourceEvidence,
  JobIssueFact,
  JobMaterialEvidence,
  JobMaterialValuation,
  JobOutputEvidence,
  JobOutputEvent,
  JobPlanFact,
} from "./types";

export class JobSourceError extends Error {}

// ---------------------------------------------------------------------------
// Raw evidence shapes the store returns — one row per underlying table row, no
// normalization/decision-making performed by the store itself.
// ---------------------------------------------------------------------------

// Real PPC plan statuses (`src/lib/inventory/plans.ts` PLAN_STATUSES). J3 (frozen parent
// decision) widened the J1 `JobPlanFact.status` enum to match this exactly — see
// `mapPlanStatus` below, now an identity pass-through, and the diagnostic-code freeze
// note appended to `docs/job-cost-sheet-implementation.md`.
export type RawPlanStatus = "Ready" | "Shortage" | "In_Production" | "Completed" | "Cancelled";

export interface RawPlan {
  planId: string;
  orgId: string;
  jobNo: string;
  productSku: string;
  productName: string;
  bomId: string;
  bomVersion: string;
  status: RawPlanStatus;
  startedAt: string | null;
}

export interface RawPlanMaterial {
  sku: string;
  itemName: string;
  uom: string;
  requiredQty: string | null;
  consumedQty: string | null;
}

export interface RawStockMovement {
  id: string;
  timestamp: string;
  sku: string;
  uom: string;
  direction: "In" | "Out";
  quantity: string;
  source: string;
  referenceId: string;
  userId: string;
}

export interface RawPurchaseRateRow {
  poId: string;
  lineId: string;
  indentId: string;
  receiptId: string;
  uom: string;
  newPrice: string | null;
  oldPrice: string | null;
  receivedAt: string;
  poStatus: string;
  indentStatus: string;
}

export interface RawStandardRateRow {
  standardId: string;
  uom: string;
  rate: string;
  effectiveDate: string;
  approvedBy: string;
  approvedAt: string;
  reason: string;
}

export interface RawGeneralPoLine {
  poId: string;
  lineId: string;
  planId: string;
  poStatus: "Open" | "Completed" | "Cancelled";
  /** Free text, not validated against any master (`src/lib/purchase/generalOrders.ts`'s
   * `GeneralPoLineInput.uom` is optional and often blank) — passed through as recorded,
   * never guessed; a blank value is treated as malformed source evidence below because
   * the frozen J1 schema requires a nonempty UOM (see the module-level deviation note). */
  uom: string;
  qty: string;
  rate: string;
  amount: string;
  receivedQty: string | null;
  headerReceivedAt: string | null;
  headerReceivedBy: string | null;
  invoiceUrl: string;
}

/** Everything the adapter needs, each method a single read-only tenant-scoped query. */
export interface JobSourceStore {
  loadPlan(orgId: string, planId: string): Promise<RawPlan | null>;
  loadItemUom(orgId: string, sku: string): Promise<string | null>;
  loadPlanMaterials(orgId: string, planId: string): Promise<RawPlanMaterial[]>;
  /** Every stock_ledger row referencing this plan — any source/direction, unfiltered;
   * the composer classifies them so noncanonical movements are disclosed, never dropped. */
  loadPlanMovements(orgId: string, planId: string): Promise<RawStockMovement[]>;
  /** `fms_runs.id` for every run whose `contextRef` is `PRODUCTION_PLANS:<planId>` —
   * mirrors `src/lib/fms/engine.ts`'s `hasFmsLine` identity exactly. */
  loadFmsRunIds(orgId: string, planId: string): Promise<string[]>;
  /** Every tenant-wide (not plan-linked) indent -> PO-line -> receipt join for this SKU —
   * existing-stock issues must be valuable too, per the contract. */
  loadPurchaseRateCandidates(orgId: string, sku: string): Promise<RawPurchaseRateRow[]>;
  loadStandardRates(orgId: string, sku: string): Promise<RawStandardRateRow[]>;
  loadGeneralPoLines(orgId: string, planId: string): Promise<RawGeneralPoLine[]>;
}

// ---------------------------------------------------------------------------
// Canonicalization helpers — shared decimal/money formatting, no engine logic.
// ---------------------------------------------------------------------------

function canonicalQty(raw: string): string {
  return quantity(units(decimal.parse(raw)));
}
/** Formats a plain decimal value as a cents-precision (2 fractional digit) money string. */
function canonicalCents(raw: string): string {
  return money(round(units(decimal.parse(raw)) * BigInt(100), SCALE));
}
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
function istCalendarDate(instantIso: string): string {
  return new Date(Date.parse(instantIso) + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** J3 (frozen parent decision): the J1 `JobPlanFact.status` enum now matches the real
 * `productionPlans.status` enum exactly (`Ready|Shortage|In_Production|Completed|Cancelled`),
 * so this is an identity pass-through — kept as a named function so call sites document
 * intent and so a future narrowing/widening has one place to change. */
function mapPlanStatus(status: RawPlanStatus): JobPlanFact["status"] {
  return status;
}

// ---------------------------------------------------------------------------
// Pure composition — DB-free, exercised directly by fixtures in tests.
// ---------------------------------------------------------------------------

export interface JobSourceParams {
  orgId: string;
  planId: string;
  asOfDate: string;
  capturedBy: string;
}

function selectPurchaseRate(
  candidates: RawPurchaseRateRow[],
  materialUom: string,
  issueTimestamp: string,
  diagnostics: JobDiagnostic[]
): JobMaterialValuation | null {
  const eligible = candidates.filter(
    (c) => c.poStatus !== "Cancelled" && c.indentStatus !== "Cancelled" && c.uom === materialUom
  );
  const byReceipt = new Map<string, Set<string>>();
  for (const c of eligible) {
    const lines = byReceipt.get(c.receiptId) ?? new Set<string>();
    lines.add(c.lineId);
    byReceipt.set(c.receiptId, lines);
  }
  const ambiguousReceipts = new Set([...byReceipt].filter(([, lines]) => lines.size !== 1).map(([id]) => id));
  if (ambiguousReceipts.size > 0) {
    diagnostics.push({
      code: "AMBIGUOUS_RATE_SOURCE_EXCLUDED",
      blocking: false,
      sourceIds: [...ambiguousReceipts],
      message: "Receipt event maps to more than one PO line for this SKU; excluded from issue-date rate eligibility rather than guessed.",
    });
  }
  const valid = eligible.filter((c) => {
    if (ambiguousReceipts.has(c.receiptId)) return false;
    const rate = c.newPrice ?? c.oldPrice;
    if (rate === null || !decimal.safeParse(rate).success) return false;
    if (!Number.isFinite(Date.parse(c.receivedAt)) || Date.parse(c.receivedAt) > Date.parse(issueTimestamp)) return false;
    return true;
  });
  // Stable tie-break by timestamp, then receipt-event identity (the join's own unique anchor).
  valid.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || (a.receiptId < b.receiptId ? 1 : a.receiptId > b.receiptId ? -1 : 0));
  const picked = valid[0];
  if (!picked) return null;
  const rate = picked.newPrice ?? picked.oldPrice!;
  return {
    kind: "PurchaseAgreedProvisional",
    rate: canonicalQty(rate),
    uom: picked.uom,
    currency: "INR",
    date: toIso(picked.receivedAt),
    poId: picked.poId,
    lineId: picked.lineId,
    indentId: picked.indentId,
    receiptId: picked.receiptId,
  };
}

function selectStandardRate(
  candidates: RawStandardRateRow[],
  materialUom: string,
  issueTimestamp: string
): JobMaterialValuation | null {
  const istDate = istCalendarDate(issueTimestamp);
  const valid = candidates.filter((s) => s.uom === materialUom && s.effectiveDate <= istDate && decimal.safeParse(s.rate).success);
  valid.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.approvedAt.localeCompare(a.approvedAt) || b.standardId.localeCompare(a.standardId));
  const picked = valid[0];
  if (!picked) return null;
  return {
    kind: "ApprovedStandardProvisional",
    rate: canonicalQty(picked.rate),
    uom: picked.uom,
    currency: "INR",
    date: picked.effectiveDate,
    standardId: picked.standardId,
    approvedBy: picked.approvedBy,
    approvedAt: toIso(picked.approvedAt),
    reason: picked.reason,
  };
}

function buildMaterialEvidence(
  material: RawPlanMaterial,
  movements: RawStockMovement[],
  purchaseCandidates: RawPurchaseRateRow[],
  standardCandidates: RawStandardRateRow[],
  diagnostics: JobDiagnostic[]
): { evidence: JobMaterialEvidence; classifiedMovementIds: Set<string> } {
  const classified = new Set<string>();
  const candidatesBySku = movements.filter(
    (m) => m.source === "Production" && m.direction === "Out" && m.sku === material.sku
  );
  const qualified = candidatesBySku.filter((m) => m.uom === material.uom);
  const mismatched = candidatesBySku.filter((m) => m.uom !== material.uom);
  for (const m of candidatesBySku) classified.add(m.id);

  let reconciliation: "Reconciled" | "Incomplete" = "Reconciled";
  if (mismatched.length > 0) {
    reconciliation = "Incomplete";
    diagnostics.push({
      code: "MATERIAL_UOM_MISMATCH",
      blocking: true,
      sourceIds: [material.sku, ...mismatched.map((m) => m.id)],
      message: `Recorded issue UOM differs from the plan's snapshotted material UOM for ${material.sku}; not silently reconciled.`,
    });
  }

  const issues: JobIssueFact[] = qualified.map((m) => ({
    id: m.id,
    timestamp: toIso(m.timestamp),
    quantity: canonicalQty(m.quantity),
    userId: m.userId,
  }));

  let valuation: JobMaterialValuation = { kind: "Missing" };
  if (qualified.length === 1) {
    const issueTimestamp = toIso(qualified[0].timestamp);
    valuation =
      selectPurchaseRate(purchaseCandidates, material.uom, issueTimestamp, diagnostics) ??
      selectStandardRate(standardCandidates, material.uom, issueTimestamp) ?? { kind: "Missing" };
  }

  const evidence: JobMaterialEvidence = {
    sku: material.sku,
    name: material.itemName,
    uom: material.uom,
    requiredQty: material.requiredQty !== null ? canonicalQty(material.requiredQty) : null,
    consumedQty: material.consumedQty !== null ? canonicalQty(material.consumedQty) : null,
    reconciliation,
    issues,
    valuation,
  };
  return { evidence, classifiedMovementIds: classified };
}

function buildOutputEvidence(
  plan: RawPlan,
  movements: RawStockMovement[],
  fmsRunIds: string[],
  diagnostics: JobDiagnostic[]
): { evidence: JobOutputEvidence; classifiedMovementIds: Set<string> } {
  const classified = new Set<string>();
  const candidates = movements.filter((m) => m.source === "Production_Output" && m.direction === "In");
  for (const m of candidates) classified.add(m.id);
  const conflicting = candidates.filter((m) => m.sku !== plan.productSku);
  let reconciliation: "Reconciled" | "Incomplete" = "Reconciled";
  if (conflicting.length > 0) {
    reconciliation = "Incomplete";
    diagnostics.push({
      code: "OUTPUT_PRODUCT_MISMATCH",
      blocking: true,
      sourceIds: conflicting.map((m) => m.id),
      message: "A completion-ledger event referencing this plan records a different product SKU than the plan's own; disclosed, not discarded.",
    });
  }
  const events: JobOutputEvent[] = candidates.map((m) => ({
    id: m.id,
    timestamp: toIso(m.timestamp),
    quantity: canonicalQty(m.quantity),
    userId: m.userId,
    sku: m.sku,
    uom: m.uom,
    referenceId: m.referenceId,
    source: m.source,
    direction: m.direction,
  }));
  const evidence: JobOutputEvidence = { reconciliation, runIds: fmsRunIds, events };
  return { evidence, classifiedMovementIds: classified };
}

function buildGeneralSourceEvidence(line: RawGeneralPoLine, diagnostics: JobDiagnostic[]): JobGeneralSourceEvidence | null {
  if (!line.uom.trim()) {
    diagnostics.push({
      code: "GENERAL_LINE_MALFORMED_SOURCE",
      blocking: true,
      sourceIds: [line.lineId],
      message: "General PO line has no recorded UOM; excluded rather than substituting a placeholder unit.",
    });
    return null;
  }
  for (const [label, raw] of [["qty", line.qty], ["rate", line.rate], ["amount", line.amount]] as const) {
    if (!decimal.safeParse(raw).success) {
      diagnostics.push({
        code: "GENERAL_LINE_MALFORMED_SOURCE",
        blocking: true,
        sourceIds: [line.lineId],
        message: `General PO line ${label} is not a valid nonnegative recorded decimal; excluded rather than defaulted.`,
      });
      return null;
    }
  }
  if (line.receivedQty !== null && !decimal.safeParse(line.receivedQty).success) {
    diagnostics.push({
      code: "GENERAL_LINE_MALFORMED_SOURCE",
      blocking: true,
      sourceIds: [line.lineId],
      message: "General PO line receivedQty is not a valid nonnegative recorded decimal; excluded rather than defaulted.",
    });
    return null;
  }
  const receivedAt = line.poStatus === "Completed" ? line.headerReceivedAt : null;
  const receivedBy = line.poStatus === "Completed" ? line.headerReceivedBy : null;
  const evidenceRefs = line.invoiceUrl ? [line.invoiceUrl] : [];
  return {
    poId: line.poId,
    lineId: line.lineId,
    planId: line.planId,
    status: line.poStatus,
    orderedQty: canonicalQty(line.qty),
    receivedQty: line.receivedQty !== null ? canonicalQty(line.receivedQty) : null,
    receivedAt: receivedAt !== null ? toIso(receivedAt) : null,
    receivedBy,
    uom: line.uom,
    rate: canonicalQty(line.rate),
    orderedAmount: canonicalCents(line.amount),
    sourceFingerprint: fingerprintOf({ poId: line.poId, lineId: line.lineId, qty: line.qty, rate: line.rate, amount: line.amount, receivedQty: line.receivedQty, receivedAt, receivedBy, poStatus: line.poStatus }),
    // No `job_cost_source_allocations` table exists yet (J3/J4 persistence is out of
    // scope for this read-only slice) — always "0.00" here. See the module-level
    // deviation note: J1's calculateJobCost treats this as live concurrent-claim state,
    // which this adapter cannot yet supply.
    activeAllocatedAmount: "0.00",
    reconciliation: "Reconciled",
    evidenceRefs,
  };
}

function fingerprintOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Pure, DB-free composition: builds the exact J1 `JobCostFacts` shape from already-fetched
 * raw evidence. Never fetches anything itself — callers (fixtures or `fetchJobSourceFacts`)
 * own all I/O, which is what makes this directly unit-testable. */
export function composeJobCostFacts(
  params: JobSourceParams,
  raw: {
    plan: RawPlan;
    productUom: string | null;
    materials: RawPlanMaterial[];
    movements: RawStockMovement[];
    fmsRunIds: string[];
    purchaseCandidatesBySku: Map<string, RawPurchaseRateRow[]>;
    standardCandidatesBySku: Map<string, RawStandardRateRow[]>;
    generalLines: RawGeneralPoLine[];
  },
  capturedAt: string
): JobCostFacts {
  if (raw.plan.planId !== params.planId || raw.plan.orgId !== params.orgId) {
    throw new JobSourceError("Plan does not belong to the requested tenant/identity");
  }
  if (raw.productUom === null) {
    // The frozen J1 `jobCostFactsSchema` requires a nonempty `plan.productUom` string —
    // there is no way to represent "Items master missing" inside that shape without
    // fabricating a placeholder unit, which the contract explicitly forbids. Refusing to
    // build facts at all (a thrown, caught-by-caller precondition failure) is the honest
    // option under the current frozen schema; see the module-level deviation note for the
    // parent decision this stage cannot make unilaterally (loosen the schema vs. keep this
    // as a hard precondition).
    throw new JobSourceError(`Plan product SKU ${raw.plan.productSku} has no Items-master row; recorded output UOM cannot be established.`);
  }
  const productUom: string = raw.productUom;

  const diagnostics: JobDiagnostic[] = [];

  const { evidence: output, classifiedMovementIds: outputClassified } = buildOutputEvidence(
    raw.plan,
    raw.movements,
    raw.fmsRunIds,
    diagnostics
  );

  const materials: JobMaterialEvidence[] = [];
  const materialClassified = new Set<string>();
  for (const material of raw.materials) {
    const { evidence, classifiedMovementIds } = buildMaterialEvidence(
      material,
      raw.movements,
      raw.purchaseCandidatesBySku.get(material.sku) ?? [],
      raw.standardCandidatesBySku.get(material.sku) ?? [],
      diagnostics
    );
    materials.push(evidence);
    for (const id of classifiedMovementIds) materialClassified.add(id);
  }

  const knownMaterialSkus = new Set(raw.materials.map((m) => m.sku));
  for (const m of raw.movements) {
    if (outputClassified.has(m.id) || materialClassified.has(m.id)) continue;
    if (m.source === "Production" && m.direction === "Out" && !knownMaterialSkus.has(m.sku)) {
      diagnostics.push({
        code: "UNKNOWN_SKU_MATERIAL_ISSUE",
        blocking: true,
        sourceIds: [m.id, m.sku],
        message: `Recorded Out/Production issue references SKU ${m.sku}, which is not a plan material; cannot be attributed.`,
      });
    } else {
      diagnostics.push({
        code: "UNCLASSIFIED_PLAN_MOVEMENT",
        blocking: true,
        sourceIds: [m.id],
        message: `Stock ledger movement (source=${m.source}, direction=${m.direction}) references this plan outside the recognized issue/output pattern; disclosed, not netted.`,
      });
    }
  }

  const generalSources: JobGeneralSourceEvidence[] = [];
  for (const line of raw.generalLines) {
    if (line.planId !== params.planId) continue;
    const evidence = buildGeneralSourceEvidence(line, diagnostics);
    if (evidence) generalSources.push(evidence);
  }

  const plan: JobPlanFact = {
    planId: raw.plan.planId,
    jobNo: raw.plan.jobNo,
    productSku: raw.plan.productSku,
    productName: raw.plan.productName,
    productUom: productUom,
    bomId: raw.plan.bomId,
    bomVersion: raw.plan.bomVersion,
    status: mapPlanStatus(raw.plan.status),
    startedAt: raw.plan.startedAt !== null ? toIso(raw.plan.startedAt) : null,
  };

  const sourceFingerprint = fingerprintOf({
    plan,
    materials: [...materials].sort((a, b) => a.sku.localeCompare(b.sku)),
    output,
    generalSources: [...generalSources].sort((a, b) => a.lineId.localeCompare(b.lineId)),
  });

  return {
    orgId: params.orgId,
    capturedAt,
    capturedBy: params.capturedBy,
    sourceFingerprint,
    plan,
    materials,
    output,
    generalSources,
    diagnostics,
  };
}

/** Fetches every raw evidence row through the injected store, then composes facts.
 * This is the one function real callers (a future protected preview route) use. */
export async function buildJobCostFacts(store: JobSourceStore, params: JobSourceParams): Promise<JobCostFacts> {
  const plan = await store.loadPlan(params.orgId, params.planId);
  if (!plan) throw new JobSourceError("Production plan not found for this tenant");

  const [productUom, materials, movements, fmsRunIds, generalLines] = await Promise.all([
    store.loadItemUom(params.orgId, plan.productSku),
    store.loadPlanMaterials(params.orgId, params.planId),
    store.loadPlanMovements(params.orgId, params.planId),
    store.loadFmsRunIds(params.orgId, params.planId),
    store.loadGeneralPoLines(params.orgId, params.planId),
  ]);

  const purchaseCandidatesBySku = new Map<string, RawPurchaseRateRow[]>();
  const standardCandidatesBySku = new Map<string, RawStandardRateRow[]>();
  await Promise.all(
    materials.map(async (material) => {
      const [purchases, standards] = await Promise.all([
        store.loadPurchaseRateCandidates(params.orgId, material.sku),
        store.loadStandardRates(params.orgId, material.sku),
      ]);
      purchaseCandidatesBySku.set(material.sku, purchases);
      standardCandidatesBySku.set(material.sku, standards);
    })
  );

  return composeJobCostFacts(
    params,
    { plan, productUom, materials, movements, fmsRunIds, purchaseCandidatesBySku, standardCandidatesBySku, generalLines },
    new Date().toISOString()
  );
}

// ---------------------------------------------------------------------------
// Production store — real schema reads only, every query tenant-scoped. Not exercised
// by the DB-free test suite; wiring is covered by the typecheck/lint gates only.
// ---------------------------------------------------------------------------

/** Dynamically imported, not top-level: pulling in `@/db/client` eagerly throws when
 * `DATABASE_URL` is unset, which would break every DB-free unit test that merely imports
 * this module for its pure `composeJobCostFacts`/`buildJobCostFacts` exports (see
 * `src/lib/inventory/plans.ts`'s own dynamic `@/lib/fms/engine` import for the identical
 * reason). Loaded once per process and memoized. */
let dbModulePromise: Promise<{
  db: typeof import("@/db/client").db;
  schema: typeof import("@/db/schema");
}> | null = null;
async function loadDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = Promise.all([import("@/db/client"), import("@/db/schema")]).then(([client, schema]) => ({
      db: client.db,
      schema,
    }));
  }
  return dbModulePromise;
}

export function createDbJobSourceStore(): JobSourceStore {
  return {
    async loadPlan(orgId, planId) {
      const { db, schema } = await loadDbModule();
      const { productionPlans } = schema;
      const [row] = await db
        .select()
        .from(productionPlans)
        .where(and(eq(productionPlans.orgId, orgId), eq(productionPlans.id, planId)))
        .limit(1);
      if (!row) return null;
      return {
        planId: row.id,
        orgId: row.orgId,
        jobNo: row.jobNo,
        productSku: row.productSku,
        productName: row.productName,
        bomId: row.bomId,
        bomVersion: row.bomVersion,
        status: row.status,
        startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      };
    },
    async loadItemUom(orgId, sku) {
      const { db, schema } = await loadDbModule();
      const { items } = schema;
      const [row] = await db
        .select({ uom: items.uom })
        .from(items)
        .where(and(eq(items.orgId, orgId), eq(items.sku, sku)))
        .limit(1);
      return row ? row.uom : null;
    },
    async loadPlanMaterials(orgId, planId) {
      const { db, schema } = await loadDbModule();
      const { planMaterials } = schema;
      const rows = await db
        .select()
        .from(planMaterials)
        .where(and(eq(planMaterials.orgId, orgId), eq(planMaterials.planId, planId)));
      return rows.map((r) => ({
        sku: r.sku,
        itemName: r.itemName,
        uom: r.uom,
        requiredQty: r.requiredQty,
        consumedQty: r.consumedQty,
      }));
    },
    async loadPlanMovements(orgId, planId) {
      const { db, schema } = await loadDbModule();
      const { stockLedger } = schema;
      const rows = await db
        .select()
        .from(stockLedger)
        .where(and(eq(stockLedger.orgId, orgId), eq(stockLedger.referenceId, planId)));
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        sku: r.sku,
        uom: r.uom,
        direction: r.direction as "In" | "Out",
        quantity: r.quantity,
        source: r.source,
        referenceId: r.referenceId,
        userId: r.userId,
      }));
    },
    async loadFmsRunIds(orgId, planId) {
      const { db, schema } = await loadDbModule();
      const { fmsRuns } = schema;
      // Mirrors `src/lib/fms/engine.ts`'s own `hasFmsLine` select exactly, listing every
      // matching run id instead of checking existence only.
      const rows = await db
        .select({ id: fmsRuns.id })
        .from(fmsRuns)
        .where(and(eq(fmsRuns.orgId, orgId), eq(fmsRuns.contextRef, `PRODUCTION_PLANS:${planId}`)));
      return rows.map((r) => r.id);
    },
    async loadPurchaseRateCandidates(orgId, sku) {
      const { db, schema } = await loadDbModule();
      const { indents, purchaseOrderLines, purchaseOrders, stockLedger } = schema;
      const rows = await db
        .select({
          poId: purchaseOrders.id,
          lineId: purchaseOrderLines.id,
          indentId: indents.id,
          receiptId: stockLedger.id,
          uom: indents.uom,
          newPrice: purchaseOrderLines.newPrice,
          oldPrice: purchaseOrderLines.oldPrice,
          receivedAt: stockLedger.timestamp,
          poStatus: purchaseOrders.status,
          indentStatus: indents.status,
        })
        .from(indents)
        .innerJoin(
          purchaseOrderLines,
          and(eq(purchaseOrderLines.orgId, orgId), eq(purchaseOrderLines.indentId, indents.id), eq(purchaseOrderLines.poId, indents.poId), eq(purchaseOrderLines.sku, indents.sku))
        )
        .innerJoin(purchaseOrders, and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.id, purchaseOrderLines.poId)))
        .innerJoin(
          stockLedger,
          and(eq(stockLedger.orgId, orgId), eq(stockLedger.referenceId, indents.id), eq(stockLedger.sku, indents.sku), eq(stockLedger.source, "Indent_Receipt"), eq(stockLedger.direction, "In"))
        )
        .where(and(eq(indents.orgId, orgId), eq(indents.sku, sku)));
      return rows
        .filter((r) => r.receiptId !== null)
        .map((r) => ({
          poId: r.poId,
          lineId: r.lineId,
          indentId: r.indentId,
          receiptId: r.receiptId!,
          uom: r.uom,
          newPrice: r.newPrice,
          oldPrice: r.oldPrice,
          receivedAt: r.receivedAt.toISOString(),
          poStatus: r.poStatus,
          indentStatus: r.indentStatus,
        }));
    },
    async loadStandardRates(orgId, sku) {
      const { db, schema } = await loadDbModule();
      const { standardCostRates } = schema;
      const rows = await db
        .select()
        .from(standardCostRates)
        .where(and(eq(standardCostRates.orgId, orgId), eq(standardCostRates.sku, sku)));
      return rows.map((r) => ({
        standardId: r.id,
        uom: r.uom,
        rate: r.rate,
        effectiveDate: r.effectiveDate,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt.toISOString(),
        reason: r.reason,
      }));
    },
    async loadGeneralPoLines(orgId, planId) {
      const { db, schema } = await loadDbModule();
      const { generalPurchaseOrderLines, generalPurchaseOrders } = schema;
      const rows = await db
        .select({
          poId: generalPurchaseOrders.id,
          lineId: generalPurchaseOrderLines.id,
          planId: generalPurchaseOrders.planId,
          poStatus: generalPurchaseOrders.status,
          uom: generalPurchaseOrderLines.uom,
          qty: generalPurchaseOrderLines.qty,
          rate: generalPurchaseOrderLines.rate,
          amount: generalPurchaseOrderLines.amount,
          receivedQty: generalPurchaseOrderLines.receivedQty,
          headerReceivedAt: generalPurchaseOrders.receivedAt,
          headerReceivedBy: generalPurchaseOrders.receivedBy,
          invoiceUrl: generalPurchaseOrders.invoiceUrl,
        })
        .from(generalPurchaseOrderLines)
        .innerJoin(generalPurchaseOrders, and(eq(generalPurchaseOrders.orgId, orgId), eq(generalPurchaseOrders.id, generalPurchaseOrderLines.poId)))
        .where(and(eq(generalPurchaseOrderLines.orgId, orgId), eq(generalPurchaseOrders.planId, planId)));
      return rows.map((r) => ({
        poId: r.poId,
        lineId: r.lineId,
        planId: r.planId,
        poStatus: r.poStatus,
        uom: r.uom,
        qty: r.qty,
        rate: r.rate,
        amount: r.amount,
        receivedQty: r.receivedQty,
        headerReceivedAt: r.headerReceivedAt ? r.headerReceivedAt.toISOString() : null,
        headerReceivedBy: r.headerReceivedBy || null,
        invoiceUrl: r.invoiceUrl,
      }));
    },
  };
}

/** Protected preview entry point for a future route/UI (J5) — not wired to HTTP here.
 * `capturedBy` is the live authorized actor id; callers must resolve it themselves,
 * matching every other service in this codebase (never trust a client-supplied actor). */
export async function previewJobCostFacts(orgId: string, planId: string, capturedBy: string): Promise<JobCostFacts> {
  const store = createDbJobSourceStore();
  return buildJobCostFacts(store, { orgId, planId, asOfDate: istCalendarDate(new Date().toISOString()), capturedBy });
}
