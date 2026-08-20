import {
  appendModuleRows,
  getModuleRows,
  recordToRow,
  updateModuleCells,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { numOr0 } from "@/lib/inventory/items";
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

export { allocateAcrossPool };
export type {
  AllocationLine,
  AllocationMaterial,
  AllocatedMaterial,
  AllocationResult,
} from "@/lib/inventory/allocation";

const PLANS_KEY = "PRODUCTION_PLANS";
const MATERIALS_KEY = "PLAN_MATERIALS";

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

export interface PlanRow {
  Plan_ID: string;
  Timestamp: string;
  Product_Name: string;
  Product_SKU: string;
  BOM_ID: string;
  BOM_Version: string;
  Planned_Qty: string;
  Production_Date: string;
  Status: string;
  Actual_Qty: string;
  Started_By: string;
  Started_At: string;
  Created_By: string;
  Notes: string;
}

export interface PlanMaterialRow {
  Plan_ID: string;
  SKU: string;
  Item_Name: string;
  Qty_Per_Unit: string;
  Required_Qty: string;
  UOM: string;
  Allocated_Qty: string;
  Shortage_Qty: string;
  Consumed_Qty: string;
  Status: string;
}

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
}

export async function listPlanRows(): Promise<PlanRow[]> {
  return getModuleRows<PlanRow>(PLANS_KEY);
}

export async function listPlanMaterialRows(): Promise<PlanMaterialRow[]> {
  return getModuleRows<PlanMaterialRow>(MATERIALS_KEY);
}

function toMaterial(row: PlanMaterialRow): PlanMaterial {
  return {
    sku: row.SKU,
    itemName: row.Item_Name,
    qtyPerUnit: numOr0(row.Qty_Per_Unit),
    requiredQty: numOr0(row.Required_Qty),
    uom: row.UOM,
    allocatedQty: numOr0(row.Allocated_Qty),
    shortageQty: numOr0(row.Shortage_Qty),
    consumedQty: numOr0(row.Consumed_Qty),
    status: row.Status,
  };
}

export function joinPlans(plans: PlanRow[], materials: PlanMaterialRow[]): Plan[] {
  const byPlan = new Map<string, PlanMaterial[]>();
  for (const row of materials) {
    if (!row.Plan_ID) continue;
    const list = byPlan.get(row.Plan_ID) ?? [];
    list.push(toMaterial(row));
    byPlan.set(row.Plan_ID, list);
  }

  return plans
    .filter((p) => p.Plan_ID)
    .map((p) => ({
      planId: p.Plan_ID,
      timestamp: p.Timestamp,
      productName: p.Product_Name,
      productSku: p.Product_SKU,
      bomId: p.BOM_ID,
      bomVersion: Number(p.BOM_Version) || 1,
      plannedQty: numOr0(p.Planned_Qty),
      productionDate: p.Production_Date,
      status: (p.Status as PlanStatus) || "Ready",
      actualQty: p.Actual_Qty ? numOr0(p.Actual_Qty) : null,
      startedBy: p.Started_By,
      startedAt: p.Started_At,
      createdBy: p.Created_By,
      notes: p.Notes,
      materials: byPlan.get(p.Plan_ID) ?? [],
    }))
    .sort(
      (a, b) =>
        a.productionDate.localeCompare(b.productionDate) ||
        b.timestamp.localeCompare(a.timestamp)
    );
}

export async function listPlans(): Promise<Plan[]> {
  const [plans, materials] = await Promise.all([
    listPlanRows(),
    listPlanMaterialRows(),
  ]);
  return joinPlans(plans, materials);
}

/**
 * Material reserved by production plans that have not consumed it yet.
 *
 * This is the function `free = on_hand − committed` is built on, so every screen that
 * already reads free stock started respecting plan reservations the moment it was filled
 * in. It lives here rather than in ledger.ts because plans own the data it derives from.
 */
export async function committedBySku(): Promise<Map<string, number>> {
  const [plans, materials] = await Promise.all([
    listPlanRows().catch(() => [] as PlanRow[]),
    listPlanMaterialRows().catch(() => [] as PlanMaterialRow[]),
  ]);

  const reserving = new Set(
    plans
      .filter((p) => RESERVING.includes(p.Status as PlanStatus))
      .map((p) => p.Plan_ID)
  );

  const out = new Map<string, number>();
  for (const row of materials) {
    if (!reserving.has(row.Plan_ID) || !row.SKU) continue;
    const held = numOr0(row.Allocated_Qty) - numOr0(row.Consumed_Qty);
    if (held <= 0) continue;
    out.set(row.SKU, round3((out.get(row.SKU) ?? 0) + held));
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
  const { boms, free } = await planContext();
  const prepared = toAllocationLines(lines, boms);
  const results = allocateAcrossPool(
    prepared.map((p) => p.alloc),
    free
  );
  const byKey = new Map(results.map((r) => [r.key, r]));

  const now = new Date().toISOString();
  const planRows: string[][] = [];
  const materialRows: string[][] = [];
  const created: Plan[] = [];

  for (const { line, bom, alloc } of prepared) {
    const result = byKey.get(alloc.key);
    if (!result) continue;

    const planId = generateId("PLAN");

    const row: PlanRow = {
      Plan_ID: planId,
      Timestamp: now,
      Product_Name: bom.productName,
      Product_SKU: bom.productSku,
      BOM_ID: bom.bomId,
      BOM_Version: String(bom.version),
      Planned_Qty: String(line.plannedQty),
      Production_Date: line.productionDate,
      Status: result.status,
      Actual_Qty: "",
      Started_By: "",
      Started_At: "",
      Created_By: createdBy,
      Notes: line.notes ?? "",
    };
    planRows.push(recordToRow(PLANS_KEY, row));

    for (const m of result.materials) {
      const materialRow: PlanMaterialRow = {
        Plan_ID: planId,
        SKU: m.sku,
        Item_Name: m.itemName,
        Qty_Per_Unit: String(m.qtyPerUnit),
        Required_Qty: String(m.requiredQty),
        UOM: m.uom,
        Allocated_Qty: String(m.allocatedQty),
        Shortage_Qty: String(m.shortageQty),
        Consumed_Qty: "",
        Status: m.shortageQty > 0 ? "Shortage" : "Allocated",
      };
      materialRows.push(recordToRow(MATERIALS_KEY, materialRow));
    }

    created.push({
      planId,
      timestamp: now,
      productName: bom.productName,
      productSku: bom.productSku,
      bomId: bom.bomId,
      bomVersion: bom.version,
      plannedQty: line.plannedQty,
      productionDate: line.productionDate,
      status: result.status,
      actualQty: null,
      startedBy: "",
      startedAt: "",
      createdBy,
      notes: line.notes ?? "",
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
  await appendModuleRows(MATERIALS_KEY, materialRows);
  await appendModuleRows(PLANS_KEY, planRows);

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

/** Row numbers of one plan's material rows — a plan spans several. */
async function materialRowNumbers(planId: string): Promise<Map<string, number>> {
  const rows = await listPlanMaterialRows();
  const out = new Map<string, number>();
  rows.forEach((row, i) => {
    if (row.Plan_ID === planId) out.set(row.SKU, i + 2); // +2: header row, 1-indexed
  });
  return out;
}

async function setPlanFields(
  planId: string,
  fields: Record<string, string | number>
): Promise<void> {
  const rows = await listPlanRows();
  const index = rows.findIndex((r) => r.Plan_ID === planId);
  if (index === -1) throw new PlanError("Plan nahi mila.");
  await updateModuleCells(PLANS_KEY, [{ rowNumber: index + 2, fields }]);
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
  const plan = await loadPlan(planId);
  if (!OPEN.includes(plan.status)) {
    throw new PlanError("Sirf Ready ya Shortage plan dobara check ho sakta hai.");
  }

  const [ledger, committed] = await Promise.all([listLedger(), committedBySku()]);
  const onHand = onHandBySku(ledger);
  const rowNumbers = await materialRowNumbers(planId);

  const updates: { rowNumber: number; fields: Record<string, string | number> }[] = [];
  const materials = plan.materials.map((m) => {
    if (m.shortageQty <= 0) return m;

    const free = round3((onHand.get(m.sku) ?? 0) - (committed.get(m.sku) ?? 0));
    const topUp = round3(Math.min(m.shortageQty, Math.max(free, 0)));
    if (topUp <= 0) return m;

    const allocatedQty = round3(m.allocatedQty + topUp);
    const shortageQty = round3(m.shortageQty - topUp);
    const rowNumber = rowNumbers.get(m.sku);
    if (rowNumber) {
      updates.push({
        rowNumber,
        fields: {
          Allocated_Qty: String(allocatedQty),
          Shortage_Qty: String(shortageQty),
          Status: shortageQty > 0 ? "Shortage" : "Allocated",
        },
      });
    }
    return { ...m, allocatedQty, shortageQty };
  });

  if (updates.length > 0) await updateModuleCells(MATERIALS_KEY, updates);

  const status: PlanStatus = materials.some((m) => m.shortageQty > 0)
    ? "Shortage"
    : "Ready";
  if (status !== plan.status) await setPlanFields(planId, { Status: status });

  return { ...plan, status, materials };
}

export async function cancelPlan(planId: string): Promise<Plan> {
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
  await setPlanFields(planId, { Status: "Cancelled" });
  return { ...plan, status: "Cancelled" };
}

export async function completePlan(planId: string): Promise<Plan> {
  const plan = await loadPlan(planId);
  if (plan.status !== "In_Production") {
    throw new PlanError("Sirf chal raha plan complete ho sakta hai.");
  }
  await setPlanFields(planId, { Status: "Completed" });
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
 * Sheets has no transaction, so a mid-way failure would leave a half-consumed plan —
 * checking up front is what keeps that from happening.
 */
export async function startProduction(
  planId: string,
  actualQty: number,
  userId: string
): Promise<Plan> {
  if (!(actualQty > 0)) {
    throw new PlanError("Actual quantity 0 se zyada honi chahiye.");
  }

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
  const rowNumbers = await materialRowNumbers(planId);
  const updates: { rowNumber: number; fields: Record<string, string | number> }[] = [];
  for (const draw of draws) {
    const rowNumber = rowNumbers.get(draw.material.sku);
    if (!rowNumber) continue;
    updates.push({
      rowNumber,
      fields: {
        Allocated_Qty: String(draw.consume),
        Shortage_Qty: "0",
        Consumed_Qty: String(draw.consume),
        Status: "Consumed",
      },
    });
  }
  if (updates.length > 0) await updateModuleCells(MATERIALS_KEY, updates);

  const startedAt = new Date().toISOString();
  await setPlanFields(planId, {
    Status: "In_Production",
    Actual_Qty: String(actualQty),
    Started_By: userId,
    Started_At: startedAt,
  });

  return {
    ...plan,
    status: "In_Production",
    actualQty,
    startedBy: userId,
    startedAt,
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
