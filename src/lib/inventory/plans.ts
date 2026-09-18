import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { productionPlans, planMaterials } from "@/db/schema";
import { db } from "@/db/client";
import { listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { numOr0, findItem } from "@/lib/inventory/items";
import { listBoms, type Bom } from "@/lib/inventory/bom";
import {
  allocateAcrossPool,
  round3,
  type AllocationLine,
  type AllocatedMaterial,
} from "@/lib/inventory/allocation";
import {
  listLedger,
  onHandBySku,
  recordMovement,
  InsufficientStockError,
} from "@/lib/inventory/ledger";
import { byNewest, parseStamp } from "@/lib/timestamp";

export { allocateAcrossPool };
export type {
  AllocationLine,
  AllocationMaterial,
  AllocatedMaterial,
  AllocationResult,
} from "@/lib/inventory/allocation";

export const PLAN_STATUSES = [
  "Ready",
  "Shortage",
  "In_Production",
  "Completed",
  "Cancelled",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/**
 * Statuses whose allocation is subtracted from free stock.
 *
 * `Shortage` reserves too, and that is deliberate. A partly-allocated plan is holding
 * real material; if it did not reserve, the next plan would take what it already counted
 * on and its shortage would quietly grow after the fact. `In_Production` stays in the
 * list only for completeness — starting production sets Allocated equal to Consumed, so
 * such a plan contributes nothing.
 */
const RESERVING: readonly PlanStatus[] = ["Ready", "Shortage", "In_Production"];

/** Statuses a plan can still be worked on from. */
const OPEN: readonly PlanStatus[] = ["Ready", "Shortage"];

export interface PlanMaterial {
  sku: string;
  itemName: string;
  qtyPerUnit: number;
  requiredQty: number;
  uom: string;
  allocatedQty: number;
  shortageQty: number;
  consumedQty: number;
  status: string;
}

export interface Plan {
  planId: string;
  timestamp: string;
  productName: string;
  productSku: string;
  bomId: string;
  bomVersion: number;
  plannedQty: number;
  productionDate: string;
  status: PlanStatus;
  actualQty: number | null;
  startedBy: string;
  startedAt: string;
  createdBy: string;
  notes: string;
  materials: PlanMaterial[];
  /** Second, purely user-facing identifier — Plan_ID stays the real key everything else
   * joins on. */
  jobNo: string;
  /** Manually typed (e.g. a customer's PO number) — free text, not validated against
   * anything, since there is no Sales Order module yet. */
  orderNo: string;
  /** Which FMS Template ("Line") Start Production should run for this plan — blank means
   * the old behaviour (every Active PRODUCTION_STARTED template fires for every plan). */
  fmsTemplateId: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * `YYYY-MM-DD` in IST — the exact inverse of `parseStamp`'s IST wall-clock reading for a
 * plain date, and what `<input type="date">` submits (`plan-form.tsx`). Deliberately NOT
 * `.toISOString()` (contrast `Timestamp`/`Started_At` below): `plan-board.tsx` renders
 * `plan.productionDate` straight into the page as text, and both `allocateAcrossPool`'s
 * and this file's own sort use `localeCompare` on it — a full ISO instant would still sort
 * correctly (ISO-8601 UTC strings are lexicographically ordered) but would display as e.g.
 * "2026-09-19T18:30:00.000Z" instead of "2026-09-20", and would silently roll onto the
 * previous calendar day for anyone reading it as a date. Same fragility class CLAUDE.md
 * documents for Tasks' `Due_Date` — kept as a bare wall-clock string for the same reason.
 */
function toIstDateStamp(date: Date | null): string {
  if (!date) return "";
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

type PlanRow = InferSelectModel<typeof productionPlans>;
type PlanMaterialRow = InferSelectModel<typeof planMaterials>;

function materialFromRow(row: PlanMaterialRow): PlanMaterial {
  return {
    sku: row.sku,
    itemName: row.itemName,
    qtyPerUnit: numOr0(row.qtyPerUnit),
    requiredQty: numOr0(row.requiredQty),
    uom: row.uom,
    allocatedQty: numOr0(row.allocatedQty),
    shortageQty: numOr0(row.shortageQty),
    consumedQty: numOr0(row.consumedQty),
    status: row.status,
  };
}

function planFromRow(row: PlanRow, materials: PlanMaterial[]): Plan {
  return {
    planId: row.id,
    timestamp: row.timestamp.toISOString(),
    productName: row.productName,
    productSku: row.productSku,
    bomId: row.bomId,
    bomVersion: Number(row.bomVersion) || 1,
    plannedQty: numOr0(row.plannedQty),
    productionDate: toIstDateStamp(row.productionDate),
    status: row.status,
    actualQty: row.actualQty !== null ? numOr0(row.actualQty) : null,
    startedBy: row.startedBy,
    startedAt: row.startedAt ? row.startedAt.toISOString() : "",
    createdBy: row.createdBy,
    notes: row.notes,
    materials,
    jobNo: row.jobNo,
    orderNo: row.orderNo,
    fmsTemplateId: row.fmsTemplateId,
  };
}

export async function listPlans(): Promise<Plan[]> {
  const orgId = await getTenantOrgId();
  const [planRows, materialRows] = await Promise.all([
    listByOrg(productionPlans, orgId),
    listByOrg(planMaterials, orgId),
  ]);

  const byPlan = new Map<string, PlanMaterial[]>();
  for (const row of materialRows) {
    const list = byPlan.get(row.planId) ?? [];
    list.push(materialFromRow(row));
    byPlan.set(row.planId, list);
  }

  return planRows
    .map((row) => planFromRow(row, byPlan.get(row.id) ?? []))
    .sort(
      (a, b) =>
        a.productionDate.localeCompare(b.productionDate) ||
        byNewest(a.timestamp, b.timestamp)
    );
}

/**
 * Material reserved by production plans that have not consumed it yet.
 *
 * This is the function `free = on_hand − committed` is built on, so every screen that
 * already reads free stock started respecting plan reservations the moment it was filled
 * in. It lives here rather than in ledger.ts because plans own the data it derives from.
 */
export async function committedBySku(): Promise<Map<string, number>> {
  const orgId = await getTenantOrgId();
  const [planRows, materialRows] = await Promise.all([
    listByOrg(productionPlans, orgId).catch(() => [] as PlanRow[]),
    listByOrg(planMaterials, orgId).catch(() => [] as PlanMaterialRow[]),
  ]);

  const reserving = new Set(
    planRows.filter((p) => RESERVING.includes(p.status as PlanStatus)).map((p) => p.id)
  );

  const out = new Map<string, number>();
  for (const row of materialRows) {
    if (!reserving.has(row.planId) || !row.sku) continue;
    const held = numOr0(row.allocatedQty) - numOr0(row.consumedQty);
    if (held <= 0) continue;
    out.set(row.sku, round3((out.get(row.sku) ?? 0) + held));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Creating plans
// ---------------------------------------------------------------------------

export class PlanError extends Error {}

export interface PlanLineInput {
  productName: string;
  plannedQty: number;
  productionDate: string;
  notes?: string;
  /** A customer's PO number or similar — free text. */
  orderNo?: string;
  /** The FMS Template ("Line") Start Production should run for this plan alone. */
  fmsTemplateId?: string;
}

interface PlanContext {
  boms: Bom[];
  free: Map<string, number>;
}

async function planContext(): Promise<PlanContext> {
  const [boms, ledger, committed] = await Promise.all([
    listBoms(),
    listLedger(),
    committedBySku(),
  ]);

  const onHand = onHandBySku(ledger);
  const free = new Map<string, number>();
  for (const [sku, qty] of onHand) {
    free.set(sku, round3(qty - (committed.get(sku) ?? 0)));
  }
  // A SKU that has only ever been committed still needs an entry, or it reads as 0
  // instead of negative and a genuine over-commitment hides.
  for (const [sku, qty] of committed) {
    if (!free.has(sku)) free.set(sku, round3(-qty));
  }
  return { boms, free };
}

function bomFor(boms: Bom[], productName: string): Bom {
  const normalized = productName.trim().toLowerCase();
  const bom = boms.find(
    (b) => b.status === "Active" && b.productName.trim().toLowerCase() === normalized
  );
  if (!bom) {
    throw new PlanError(`"${productName}" ki koi active BOM nahi hai. Pehle BOM banayein.`);
  }
  return bom;
}

interface PreparedLine {
  line: PlanLineInput;
  bom: Bom;
  alloc: AllocationLine;
}

function toAllocationLines(lines: PlanLineInput[], boms: Bom[]): PreparedLine[] {
  return lines.map((line, i) => {
    const bom = bomFor(boms, line.productName);
    return {
      line,
      bom,
      alloc: {
        key: String(i),
        productionDate: line.productionDate,
        order: i,
        materials: bom.lines.map((l) => ({
          sku: l.componentSku,
          itemName: l.componentName,
          uom: l.uom,
          qtyPerUnit: l.qtyPerUnit,
          requiredQty: round3(l.qtyPerUnit * line.plannedQty),
        })),
      },
    };
  });
}

function validateLines(lines: PlanLineInput[]): void {
  if (lines.length === 0) {
    throw new PlanError("Kam se kam ek product chahiye.");
  }
  for (const line of lines) {
    if (!line.productName.trim()) {
      throw new PlanError("Har line me product chunein.");
    }
    if (!(line.plannedQty > 0)) {
      throw new PlanError(`"${line.productName}" ki quantity 0 se zyada honi chahiye.`);
    }
    if (!line.productionDate) {
      throw new PlanError(`"${line.productName}" ki production date daalein.`);
    }
  }
}

export interface PlanPreviewLine {
  productName: string;
  productSku: string;
  plannedQty: number;
  productionDate: string;
  bomVersion: number;
  status: "Ready" | "Shortage";
  materials: AllocatedMaterial[];
}

/**
 * The same allocation the real thing runs, without writing anything.
 *
 * Deliberately shares `allocateAcrossPool` with `createPlans` rather than approximating
 * it — a preview that disagreed with what submitting actually does would be worse than
 * no preview at all.
 */
export async function previewPlans(lines: PlanLineInput[]): Promise<PlanPreviewLine[]> {
  validateLines(lines);
  const { boms, free } = await planContext();
  const prepared = toAllocationLines(lines, boms);
  const results = allocateAcrossPool(
    prepared.map((p) => p.alloc),
    free
  );

  const byKey = new Map(results.map((r) => [r.key, r]));
  return prepared.map(({ line, bom, alloc }) => {
    const result = byKey.get(alloc.key);
    return {
      productName: bom.productName,
      productSku: bom.productSku,
      plannedQty: line.plannedQty,
      productionDate: line.productionDate,
      bomVersion: bom.version,
      status: result?.status ?? "Shortage",
      materials: result?.materials ?? [],
    };
  });
}

/**
 * Creates one plan per product line, allocating them all from a single shared pool.
 *
 * Each product becomes its own plan because production runs, starts and completes per
 * product — but they are allocated together, in production-date order, so the material
 * arithmetic stays honest across the whole batch.
 *
 * Plans are created already reserving. There is no unreserved draft state on purpose:
 * a draft that shows "Ready" without holding the material is exactly how two plans come
 * to depend on the same stock.
 */
export async function createPlans(
  lines: PlanLineInput[],
  createdBy: string
): Promise<Plan[]> {
  validateLines(lines);
  const orgId = await getTenantOrgId();
  const { boms, free } = await planContext();
  const prepared = toAllocationLines(lines, boms);
  const results = allocateAcrossPool(
    prepared.map((p) => p.alloc),
    free
  );
  const byKey = new Map(results.map((r) => [r.key, r]));

  const now = new Date();
  const planRows: (typeof productionPlans.$inferInsert)[] = [];
  const materialRows: (typeof planMaterials.$inferInsert)[] = [];
  const created: Plan[] = [];

  for (const { line, bom, alloc } of prepared) {
    const result = byKey.get(alloc.key);
    if (!result) continue;

    const planId = generateId("PLAN");
    const jobNo = generateId("JOB");
    const productionDate = parseStamp(line.productionDate);

    planRows.push({
      id: planId,
      orgId,
      timestamp: now,
      productName: bom.productName,
      productSku: bom.productSku,
      bomId: bom.bomId,
      bomVersion: String(bom.version),
      plannedQty: String(line.plannedQty),
      productionDate,
      status: result.status,
      actualQty: null,
      startedBy: "",
      startedAt: null,
      createdBy,
      notes: line.notes ?? "",
      jobNo,
      orderNo: line.orderNo?.trim() ?? "",
      fmsTemplateId: line.fmsTemplateId?.trim() ?? "",
    });

    for (const m of result.materials) {
      materialRows.push({
        planId,
        orgId,
        sku: m.sku,
        itemName: m.itemName,
        qtyPerUnit: String(m.qtyPerUnit),
        requiredQty: String(m.requiredQty),
        uom: m.uom,
        allocatedQty: String(m.allocatedQty),
        shortageQty: String(m.shortageQty),
        consumedQty: null,
        status: m.shortageQty > 0 ? "Shortage" : "Allocated",
        createdAt: now,
      });
    }

    created.push({
      planId,
      timestamp: now.toISOString(),
      productName: bom.productName,
      productSku: bom.productSku,
      bomId: bom.bomId,
      bomVersion: bom.version,
      plannedQty: line.plannedQty,
      productionDate: toIstDateStamp(productionDate),
      status: result.status,
      actualQty: null,
      startedBy: "",
      startedAt: "",
      createdBy,
      notes: line.notes ?? "",
      jobNo,
      orderNo: line.orderNo?.trim() ?? "",
      fmsTemplateId: line.fmsTemplateId?.trim() ?? "",
      materials: result.materials.map((m) => ({
        sku: m.sku,
        itemName: m.itemName,
        qtyPerUnit: m.qtyPerUnit,
        requiredQty: m.requiredQty,
        uom: m.uom,
        allocatedQty: m.allocatedQty,
        shortageQty: m.shortageQty,
        consumedQty: 0,
        status: m.shortageQty > 0 ? "Shortage" : "Allocated",
      })),
    });
  }

  // Materials first: a plan row with no materials would read as "nothing required" and
  // reserve nothing, whereas orphan material rows belong to no reserving plan and are
  // ignored by `committedBySku`. Neither is good, but only the first over-promises stock.
  if (materialRows.length > 0) await db.insert(planMaterials).values(materialRows);
  if (planRows.length > 0) await db.insert(productionPlans).values(planRows);

  return created;
}

// ---------------------------------------------------------------------------
// Working a plan
// ---------------------------------------------------------------------------

async function loadPlan(planId: string): Promise<Plan> {
  const plan = (await listPlans()).find((p) => p.planId === planId);
  if (!plan) throw new PlanError("Plan nahi mila.");
  return plan;
}

async function setPlanFields(
  orgId: string,
  planId: string,
  fields: Partial<typeof productionPlans.$inferInsert>
): Promise<void> {
  const updated = await updateById(productionPlans, orgId, planId, fields);
  if (!updated) throw new PlanError("Plan nahi mila.");
}

/**
 * Re-runs allocation for one short plan against stock as it now stands.
 *
 * Without this a plan that was short when it was made stays short for ever, even after
 * the indent it triggered has been received. Only this plan's own gap is topped up —
 * free stock already excludes what it holds, so there is no risk of it claiming material
 * twice.
 */
export async function reallocatePlan(planId: string): Promise<Plan> {
  const orgId = await getTenantOrgId();
  const plan = await loadPlan(planId);
  if (!OPEN.includes(plan.status)) {
    throw new PlanError("Sirf Ready ya Shortage plan dobara check ho sakta hai.");
  }

  const [ledger, committed] = await Promise.all([listLedger(), committedBySku()]);
  const onHand = onHandBySku(ledger);

  const writes: Promise<unknown>[] = [];
  const materials = plan.materials.map((m) => {
    if (m.shortageQty <= 0) return m;

    const free = round3((onHand.get(m.sku) ?? 0) - (committed.get(m.sku) ?? 0));
    const topUp = round3(Math.min(m.shortageQty, Math.max(free, 0)));
    if (topUp <= 0) return m;

    const allocatedQty = round3(m.allocatedQty + topUp);
    const shortageQty = round3(m.shortageQty - topUp);

    writes.push(
      db
        .update(planMaterials)
        .set({
          allocatedQty: String(allocatedQty),
          shortageQty: String(shortageQty),
          status: shortageQty > 0 ? "Shortage" : "Allocated",
        })
        .where(
          and(
            eq(planMaterials.orgId, orgId),
            eq(planMaterials.planId, planId),
            eq(planMaterials.sku, m.sku)
          )
        )
    );

    return { ...m, allocatedQty, shortageQty };
  });

  if (writes.length > 0) await Promise.all(writes);

  const status: PlanStatus = materials.some((m) => m.shortageQty > 0)
    ? "Shortage"
    : "Ready";
  if (status !== plan.status) await setPlanFields(orgId, planId, { status });

  return { ...plan, status, materials };
}

export async function cancelPlan(planId: string): Promise<Plan> {
  const orgId = await getTenantOrgId();
  const plan = await loadPlan(planId);
  if (!OPEN.includes(plan.status)) {
    throw new PlanError(
      plan.status === "In_Production"
        ? "Production shuru ho chuka hai — ab cancel nahi ho sakta."
        : "Ye plan pehle hi band ho chuka hai."
    );
  }
  // Nothing to reverse: no material has been issued, and dropping out of the reserving
  // statuses releases the reservation on its own.
  await setPlanFields(orgId, planId, { status: "Cancelled" });
  return { ...plan, status: "Cancelled" };
}

/**
 * Whether an FMS "Line" is already tracking this plan — i.e. starting production fired
 * PRODUCTION_STARTED and some Admin-built template picked it up. When one has, that
 * Line's own last step is what writes the FG stock (via its own Ledger Movement Action,
 * using the quantity that actually passed every stage) — completePlan() must not also
 * write one, or the same production would double-count.
 *
 * FMS is now a migrated, Postgres-backed module (fms/engine.ts owns fms_runs) — the real
 * check lives there (fms/engine.ts's own hasFmsLine, exported for exactly this caller).
 * Imported *dynamically* rather than with a top-level `import`: fms/engine.ts already
 * statically imports fms/dataSourceResolver.ts, which in turn statically imports this same
 * file (listPlans/Plan/PlanMaterial, for an "Existing FMS" pull of a plan's own fields) —
 * a top-level import back here would complete a real circular module graph. Deferring the
 * import to call time (same pattern dataSourceResolver.ts itself uses for its FMS_RUNS/
 * THIS_FLOW cases) avoids that while still calling the exact same live function.
 */
async function hasFmsLine(planId: string): Promise<boolean> {
  const { hasFmsLine: hasFmsLineEngine } = await import("@/lib/fms/engine");
  return hasFmsLineEngine(planId);
}

/**
 * Completing a plan is what actually creates its stock — "Start Production" only issues
 * raw material, it never produces anything, so until this write a plan's own product
 * never appeared anywhere on the ledger. One `In` movement, `Production_Output`-sourced,
 * for the quantity that was actually made (never the planned quantity) — a hardcoded,
 * type-checked write, not something a template can misconfigure, because "complete a
 * plan" already means exactly this and always has, this is just the first time it's
 * implemented (see docs/INVENTORY-PPC-PLAN.md's "Room left for Semi-FG").
 *
 * Skipped when an FMS Line is already tracking this plan (see hasFmsLine) — a product
 * with a real multi-step Line gets its FG stock from that Line's own final step instead,
 * at whatever quantity actually survived every stage, not the plan's optimistic actual
 * quantity from Start Production.
 */
export async function completePlan(planId: string, completedBy: string): Promise<Plan> {
  const orgId = await getTenantOrgId();
  const plan = await loadPlan(planId);
  if (plan.status !== "In_Production") {
    throw new PlanError("Sirf chal raha plan complete ho sakta hai.");
  }

  if (!(await hasFmsLine(planId))) {
    const quantity = plan.actualQty ?? plan.plannedQty;
    const item = await findItem(plan.productSku);
    if (!item) {
      throw new PlanError(
        `"${plan.productName}" (${plan.productSku}) Items master me nahi hai — pehle ise ek item (Category: FG ya Semi-FG) ke roop me add karein, phir plan complete karein.`
      );
    }

    await recordMovement({
      sku: plan.productSku,
      direction: "In",
      quantity,
      uom: item.UOM,
      source: "Production_Output",
      referenceId: plan.planId,
      location: item.Location,
      remark: `Production complete — ${plan.productName}`,
      userId: completedBy,
    });
  }

  await setPlanFields(orgId, planId, { status: "Completed" });
  return { ...plan, status: "Completed" };
}

/**
 * Consumes material for the quantity actually produced and releases the rest.
 *
 * The actual quantity is asked for rather than assumed from the plan because the two
 * differ in practice, and a system that consumes the planned figure quietly drifts from
 * what is physically on the shelf.
 *
 * Every material is checked against its allowance before a single `Out` is written.
 * Postgres has no cross-request transaction held open here either, so a mid-way failure
 * would leave a half-consumed plan — checking up front is what keeps that from happening.
 */
export async function startProduction(
  planId: string,
  actualQty: number,
  userId: string
): Promise<Plan> {
  if (!(actualQty > 0)) {
    throw new PlanError("Actual quantity 0 se zyada honi chahiye.");
  }

  const orgId = await getTenantOrgId();
  const plan = await loadPlan(planId);
  if (!OPEN.includes(plan.status)) {
    throw new PlanError("Ye plan production ke liye taiyar nahi hai.");
  }

  const [ledger, committed] = await Promise.all([listLedger(), committedBySku()]);
  const onHand = onHandBySku(ledger);

  const draws = plan.materials.map((m) => {
    const consume = round3(m.qtyPerUnit * actualQty);
    // What this plan may legitimately draw: free stock plus the reservation it already
    // holds. Without adding its own reservation back, the free-stock check would refuse
    // the very material this plan set aside.
    const free = round3((onHand.get(m.sku) ?? 0) - (committed.get(m.sku) ?? 0));
    const ownHold = round3(m.allocatedQty - m.consumedQty);
    return { material: m, consume, allowance: round3(free + ownHold) };
  });

  const short = draws.find((d) => d.consume > d.allowance);
  if (short) {
    throw new InsufficientStockError(
      `"${short.material.itemName}" kam pad raha hai — ${actualQty} banane ke liye ${short.consume} ${short.material.uom} chahiye, milega ${short.allowance} ${short.material.uom}.`
    );
  }

  for (const draw of draws) {
    await recordMovement(
      {
        sku: draw.material.sku,
        direction: "Out",
        quantity: draw.consume,
        uom: draw.material.uom,
        source: "Production",
        referenceId: planId,
        remark: `${plan.productName} — ${actualQty} unit`,
        userId,
      },
      draw.allowance
    );
  }

  // Allocated is set equal to Consumed, and that is what releases the leftover: committed
  // is measured as Allocated − Consumed, so the difference collapses to zero. What was
  // planned is not lost — Required_Qty still holds it.
  await Promise.all(
    draws.map((draw) =>
      db
        .update(planMaterials)
        .set({
          allocatedQty: String(draw.consume),
          shortageQty: "0",
          consumedQty: String(draw.consume),
          status: "Consumed",
        })
        .where(
          and(
            eq(planMaterials.orgId, orgId),
            eq(planMaterials.planId, planId),
            eq(planMaterials.sku, draw.material.sku)
          )
        )
    )
  );

  const startedAt = new Date();
  await setPlanFields(orgId, planId, {
    status: "In_Production",
    actualQty: String(actualQty),
    startedBy: userId,
    startedAt,
  });

  return {
    ...plan,
    status: "In_Production",
    actualQty,
    startedBy: userId,
    startedAt: startedAt.toISOString(),
    materials: draws.map((d) => ({
      ...d.material,
      allocatedQty: d.consume,
      shortageQty: 0,
      consumedQty: d.consume,
      status: "Consumed",
    })),
  };
}

export interface PlanShortage {
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
}

/** Every open plan's outstanding shortage, per SKU — what indents need to cover. */
export function shortagesBySku(plans: Plan[]): PlanShortage[] {
  const out = new Map<string, PlanShortage>();
  for (const plan of plans) {
    if (plan.status !== "Shortage") continue;
    for (const m of plan.materials) {
      if (m.shortageQty <= 0) continue;
      const existing = out.get(m.sku);
      out.set(m.sku, {
        sku: m.sku,
        itemName: m.itemName,
        uom: m.uom,
        qty: round3((existing?.qty ?? 0) + m.shortageQty),
      });
    }
  }
  return [...out.values()].sort((a, b) => b.qty - a.qty);
}
