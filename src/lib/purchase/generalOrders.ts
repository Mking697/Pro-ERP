import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { generalPurchaseOrderLines, generalPurchaseOrders, productionPlans, vendors } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { runIdempotentTenantMutation } from "@/lib/mutations";
import { findById, insertRecord, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { computeDefaultTatDeadline } from "@/lib/fms/calendar";
import { round2 } from "@/lib/leads/quotationMath";
import { assertFinancialNumber, MAX_QUANTITY } from "@/lib/financial-validation";

/**
 * Independent / General Purchase Order — see src/db/schema/generalPurchase.ts's own
 * header comment for why this is a deliberately separate flow from purchase/orders.ts's
 * Indent-bound one. Nothing here writes stock_ledger; a receive only records that the
 * line arrived, for Job Costing (jobCostingForPlan() below), never a stock movement.
 */

export class GeneralPurchaseOrderError extends Error {}

export interface GeneralPoLineInput {
  particular: string;
  description?: string;
  uom?: string;
  qty: number;
  rate: number;
}

export interface GeneralPoLineRecord {
  id: string;
  particular: string;
  description: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
  receivedQty: number | null;
}

export interface GeneralPurchaseOrder {
  id: string;
  vendorId: string;
  vendorName: string;
  planId: string;
  planJobNo: string;
  planProductName: string;
  status: string;
  attachmentUrl: string;
  invoiceUrl: string;
  issuedBy: string;
  issuedAt: string;
  expectedDeliveryDays: number;
  followUpDueAt: string;
  followUpDoneBy: string;
  followUpDoneAt: string;
  followUpRemark: string;
  receivedAt: string;
  receivedBy: string;
  gstPercent: number;
  termsAndConditions: string;
  note: string;
  lines: GeneralPoLineRecord[];
  subTotal: number;
  gstAmount: number;
  grandTotal: number;
}

type GeneralPoRow = InferSelectModel<typeof generalPurchaseOrders>;
type GeneralPoLineRow = InferSelectModel<typeof generalPurchaseOrderLines>;

function rowToLine(row: GeneralPoLineRow): GeneralPoLineRecord {
  return {
    id: row.id,
    particular: row.particular,
    description: row.description,
    uom: row.uom,
    qty: Number(row.qty) || 0,
    rate: Number(row.rate) || 0,
    amount: Number(row.amount) || 0,
    receivedQty: row.receivedQty === null ? null : Number(row.receivedQty) || 0,
  };
}

function rowToPo(
  row: GeneralPoRow,
  vendorName: string,
  planJobNo: string,
  planProductName: string,
  lines: GeneralPoLineRecord[]
): GeneralPurchaseOrder {
  const subTotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const gstPercent = Number(row.gstPercent) || 0;
  const gstAmount = round2((subTotal * gstPercent) / 100);
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName,
    planId: row.planId,
    planJobNo,
    planProductName,
    status: row.status,
    attachmentUrl: row.attachmentUrl,
    invoiceUrl: row.invoiceUrl,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt.toISOString(),
    expectedDeliveryDays: Number(row.expectedDeliveryDays) || 0,
    followUpDueAt: row.followUpDueAt ? row.followUpDueAt.toISOString() : "",
    followUpDoneBy: row.followUpDoneBy,
    followUpDoneAt: row.followUpDoneAt ? row.followUpDoneAt.toISOString() : "",
    followUpRemark: row.followUpRemark,
    receivedAt: row.receivedAt ? row.receivedAt.toISOString() : "",
    receivedBy: row.receivedBy,
    gstPercent,
    termsAndConditions: row.termsAndConditions,
    note: row.note,
    lines,
    subTotal,
    gstAmount,
    grandTotal: round2(subTotal + gstAmount),
  };
}

async function loadLines(orgId: string, poId: string): Promise<GeneralPoLineRecord[]> {
  const rows = await db
    .select()
    .from(generalPurchaseOrderLines)
    .where(and(eq(generalPurchaseOrderLines.orgId, orgId), eq(generalPurchaseOrderLines.poId, poId)));
  return rows.map(rowToLine);
}

async function loadPlanLabel(
  orgId: string,
  planId: string
): Promise<{ jobNo: string; productName: string }> {
  if (!planId) return { jobNo: "", productName: "" };
  const plan = await findById(productionPlans, orgId, planId);
  return plan ? { jobNo: plan.jobNo, productName: plan.productName } : { jobNo: "", productName: "" };
}

export async function getGeneralPurchaseOrder(poId: string): Promise<GeneralPurchaseOrder | null> {
  const orgId = await getTenantOrgId();
  const po = await findById(generalPurchaseOrders, orgId, poId);
  if (!po) return null;
  const [vendor, lines, plan] = await Promise.all([
    findById(vendors, orgId, po.vendorId),
    loadLines(orgId, poId),
    loadPlanLabel(orgId, po.planId),
  ]);
  return rowToPo(po, vendor?.vendorName ?? "", plan.jobNo, plan.productName, lines);
}

export type GeneralPoStage = "follow_up" | "receiving" | "all";

export async function listGeneralPurchaseOrders(
  stage: GeneralPoStage = "all"
): Promise<GeneralPurchaseOrder[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(generalPurchaseOrders).where(eq(generalPurchaseOrders.orgId, orgId));

  const filtered = rows.filter((po) => {
    if (stage === "follow_up") return po.status === "Open" && !po.followUpDoneAt;
    if (stage === "receiving") return po.status === "Open" && Boolean(po.followUpDoneAt);
    return true;
  });

  const vendorIds = [...new Set(filtered.map((p) => p.vendorId))];
  const planIds = [...new Set(filtered.map((p) => p.planId).filter(Boolean))];
  const [vendorRows, planRows] = await Promise.all([
    vendorIds.length
      ? db.select().from(vendors).where(and(eq(vendors.orgId, orgId), inArray(vendors.id, vendorIds)))
      : Promise.resolve([]),
    planIds.length
      ? db
          .select()
          .from(productionPlans)
          .where(and(eq(productionPlans.orgId, orgId), inArray(productionPlans.id, planIds)))
      : Promise.resolve([]),
  ]);
  const vendorNameMap = new Map(vendorRows.map((v) => [v.id, v.vendorName]));
  const planMap = new Map(planRows.map((p) => [p.id, p]));

  const result: GeneralPurchaseOrder[] = [];
  for (const po of filtered) {
    const lines = await loadLines(orgId, po.id);
    const plan = planMap.get(po.planId);
    result.push(
      rowToPo(po, vendorNameMap.get(po.vendorId) ?? "", plan?.jobNo ?? "", plan?.productName ?? "", lines)
    );
  }
  return result.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

export interface CreateGeneralPurchaseOrderInput {
  vendorId: string;
  planId?: string;
  lines: GeneralPoLineInput[];
  attachmentUrl: string;
  expectedDeliveryDays: number;
  gstPercent?: number;
  termsAndConditions?: string;
  note?: string;
  issuedBy: string;
}

export async function createGeneralPurchaseOrder(
  input: CreateGeneralPurchaseOrderInput,
  key?: string
): Promise<GeneralPurchaseOrder> {
  const orgId = await getTenantOrgId();
  const work = async () => {
    const result = await createGeneralPurchaseOrderInTransaction(input);
    return { ...result, lines: result.lines.map((line) => ({ ...line })) };
  };
  if (key === undefined) return runInTenantTransaction(orgId, work);
  return runIdempotentTenantMutation(
    orgId,
    {
      operation: "purchase.general.issue.v1",
      actorId: input.issuedBy,
      key,
      payload: {
        vendorId: input.vendorId,
        planId: input.planId ?? "",
        attachmentUrl: input.attachmentUrl,
        expectedDeliveryDays: input.expectedDeliveryDays,
        lines: input.lines.map((line) => ({
          particular: line.particular,
          description: line.description ?? "",
          uom: line.uom ?? "",
          qty: line.qty,
          rate: line.rate,
        })),
        ...(input.gstPercent !== undefined ? { gstPercent: input.gstPercent } : {}),
        ...(input.termsAndConditions !== undefined ? { termsAndConditions: input.termsAndConditions } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    },
    work
  );
}

async function createGeneralPurchaseOrderInTransaction(
  input: CreateGeneralPurchaseOrderInput
): Promise<GeneralPurchaseOrder> {
  if (input.lines.length === 0) {
    throw new GeneralPurchaseOrderError("Kam se kam ek item chunein.");
  }
  const attachmentUrl = input.attachmentUrl.trim();
  if (!attachmentUrl) {
    throw new GeneralPurchaseOrderError("PO attachment zaroori hai.");
  }
  assertFinancialNumber(input.gstPercent ?? 0, "GST percent", GeneralPurchaseOrderError, 100);
  let total = 0;
  for (const line of input.lines) {
    assertFinancialNumber(line.qty, "Quantity", GeneralPurchaseOrderError, MAX_QUANTITY, true);
    assertFinancialNumber(line.rate, "Rate", GeneralPurchaseOrderError);
    assertFinancialNumber(line.qty * line.rate, "Line amount", GeneralPurchaseOrderError);
    total += round2(line.qty * line.rate);
    if (!line.particular.trim()) {
      throw new GeneralPurchaseOrderError("Har line ka particular/item naam zaroori hai.");
    }
    if (!Number.isFinite(line.qty) || !(line.qty > 0)) {
      throw new GeneralPurchaseOrderError(`"${line.particular}" ki quantity 0 se zyada honi chahiye.`);
    }
    if (!Number.isFinite(line.rate) || line.rate < 0) {
      throw new GeneralPurchaseOrderError(`"${line.particular}" ka rate invalid hai.`);
    }
  }

  assertFinancialNumber(round2(total * (1 + (input.gstPercent ?? 0) / 100)), "PO total amount", GeneralPurchaseOrderError);
  const orgId = await getTenantOrgId();
  const vendor = await findById(vendors, orgId, input.vendorId);
  if (!vendor) throw new GeneralPurchaseOrderError("Vendor nahi mila.");

  const planId = input.planId?.trim() ?? "";
  if (planId) {
    const plan = await findById(productionPlans, orgId, planId);
    if (!plan) throw new GeneralPurchaseOrderError("Job (Production Plan) nahi mila.");
  }

  const issuedAt = Date.now();
  const expectedDeliveryDays = Math.max(Number(input.expectedDeliveryDays) || 0, 0);
  // Same shape as purchase/orders.ts's own fallback deadline — no per-user calendar
  // (there is no Doer concept for a General PO), the org's default working calendar.
  const followUpDays = Math.max(expectedDeliveryDays - 1, 0);
  const followUpDueAtMs = await computeDefaultTatDeadline(issuedAt, followUpDays, "Days");

  const poId = generateId("GPO");
  await insertRecord(generalPurchaseOrders, {
    id: poId,
    orgId,
    vendorId: input.vendorId,
    planId,
    status: "Open",
    attachmentUrl,
    issuedBy: input.issuedBy,
    issuedAt: new Date(issuedAt),
    expectedDeliveryDays: String(expectedDeliveryDays),
    followUpDueAt: new Date(followUpDueAtMs),
    gstPercent: String(input.gstPercent ?? 0),
    termsAndConditions: input.termsAndConditions ?? "",
    note: input.note ?? "",
  });

  for (const line of input.lines) {
    const qty = line.qty;
    const rate = line.rate;
    await insertRecord(generalPurchaseOrderLines, {
      id: generateId("GPOL"),
      orgId,
      poId,
      particular: line.particular.trim(),
      description: line.description?.trim() ?? "",
      uom: line.uom?.trim() ?? "",
      qty: String(qty),
      rate: String(rate),
      amount: String(round2(qty * rate)),
    });
  }

  const created = await getGeneralPurchaseOrder(poId);
  if (!created) throw new GeneralPurchaseOrderError("PO ban gaya lekin load nahi ho paya.");
  return created;
}

/** Step 2 — Follow Up, a real action the assignee marks done, same convention as
 *  purchase/orders.ts's markFollowUpDone(). */
export async function markGeneralFollowUpDone(
  poId: string,
  userId: string,
  remark: string
): Promise<GeneralPurchaseOrder> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const po = await findById(generalPurchaseOrders, orgId, poId);
    if (!po) throw new GeneralPurchaseOrderError("PO nahi mila.");
    if (po.status !== "Open") throw new GeneralPurchaseOrderError(`Ye PO "${po.status}" hai.`);
    if (po.followUpDoneAt) throw new GeneralPurchaseOrderError("Follow-up pehle se ho chuka hai.");

    await updateById(generalPurchaseOrders, orgId, poId, {
      followUpDoneBy: userId,
      followUpDoneAt: new Date(),
      followUpRemark: remark,
    });

    const updated = await getGeneralPurchaseOrder(poId);
    if (!updated) throw new GeneralPurchaseOrderError("PO update ho gaya lekin load nahi ho paya.");
    return updated;
  });
}

export interface ReceiveGeneralPoLineInput {
  lineId: string;
  receivedQty: number;
}

/**
 * Step 3 — Material Received. Unlike purchase/orders.ts's per-line, independently-dated
 * receiveIndent() calls, this records every line's received quantity in one action (the
 * lines here have no stock/indent machinery of their own to stay independently open
 * against) — blocked until Follow Up is done, same ordering convention as the
 * raw-material flow. Writes nothing to stock_ledger.
 */
export async function receiveGeneralPurchaseOrder(
  poId: string,
  userId: string,
  lines: ReceiveGeneralPoLineInput[],
  invoiceUrl?: string
): Promise<GeneralPurchaseOrder> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const po = await findById(generalPurchaseOrders, orgId, poId);
    if (!po) throw new GeneralPurchaseOrderError("PO nahi mila.");
    if (po.status !== "Open") throw new GeneralPurchaseOrderError(`Ye PO "${po.status}" hai.`);
    if (!po.followUpDoneAt) {
      throw new GeneralPurchaseOrderError("Pehle Follow-up complete karein, tabhi receive kar sakte hain.");
    }

    const existingLines = await db
      .select()
      .from(generalPurchaseOrderLines)
      .where(and(eq(generalPurchaseOrderLines.orgId, orgId), eq(generalPurchaseOrderLines.poId, poId)));
    const lineMap = new Map(existingLines.map((l) => [l.id, l]));

    for (const input of lines) {
      const line = lineMap.get(input.lineId);
      if (!line) throw new GeneralPurchaseOrderError("Ye item is PO me nahi hai.");
      if (!Number.isFinite(input.receivedQty) || input.receivedQty < 0) {
        throw new GeneralPurchaseOrderError(`"${line.particular}" ki received quantity invalid hai.`);
      }
      await db
        .update(generalPurchaseOrderLines)
        .set({ receivedQty: String(input.receivedQty) })
        .where(
          and(eq(generalPurchaseOrderLines.orgId, orgId), eq(generalPurchaseOrderLines.id, input.lineId))
        );
    }

    await updateById(generalPurchaseOrders, orgId, poId, {
      status: "Completed",
      receivedAt: new Date(),
      receivedBy: userId,
      ...(invoiceUrl ? { invoiceUrl } : {}),
    });

    const updated = await getGeneralPurchaseOrder(poId);
    if (!updated) throw new GeneralPurchaseOrderError("PO update ho gaya lekin load nahi ho paya.");
    return updated;
  });
}

export async function cancelGeneralPurchaseOrder(poId: string): Promise<GeneralPurchaseOrder> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const po = await findById(generalPurchaseOrders, orgId, poId);
    if (!po) throw new GeneralPurchaseOrderError("PO nahi mila.");
    if (po.status !== "Open") {
      throw new GeneralPurchaseOrderError(`Ye PO "${po.status}" hai, cancel nahi ho sakta.`);
    }

    await updateById(generalPurchaseOrders, orgId, poId, { status: "Cancelled" });
    const updated = await getGeneralPurchaseOrder(poId);
    if (!updated) throw new GeneralPurchaseOrderError("PO update ho gaya lekin load nahi ho paya.");
    return updated;
  });
}

export interface JobCostingLine {
  source: "Raw_Material" | "General";
  poId: string;
  particular: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface JobCostingReport {
  planId: string;
  jobNo: string;
  productName: string;
  rawMaterialCost: number;
  generalCost: number;
  totalCost: number;
  lines: JobCostingLine[];
}

/**
 * Job Costing — the Independent PO feature's own payoff (2026-10-19): total real cost
 * against one Production Plan ("Job"), combining raw material (the EXISTING Indent ->
 * PO chain, matched via indents.linkedPlanId — nothing new was built for this half, it
 * reads data the Purchase flow already produces) and General PO lines tagged with this
 * same planId. Deliberately COST ONLY, not a margin/profit figure — a Plan's own
 * `orderNo` is free text (CLAUDE.md: "not validated against anything, since there is no
 * Sales Order module yet" — still true: the field exists but carries no real FK to
 * `orders`), so there is no reliable revenue figure to net this cost against yet. A
 * future session wanting real margin needs to build that Plan<->Order link first — not
 * done here, flagged rather than faked with a guessed revenue number.
 */
export async function jobCostingForPlan(planId: string): Promise<JobCostingReport> {
  const orgId = await getTenantOrgId();
  const plan = await findById(productionPlans, orgId, planId);
  if (!plan) throw new GeneralPurchaseOrderError("Job (Production Plan) nahi mila.");

  const { indents, purchaseOrderLines } = await import("@/db/schema");
  const indentRows = await db
    .select()
    .from(indents)
    .where(and(eq(indents.orgId, orgId), eq(indents.linkedPlanId, planId)));

  const rawLines: JobCostingLine[] = [];
  for (const indent of indentRows) {
    if (!indent.poId) continue;
    const [poLine] = await db
      .select()
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.orgId, orgId),
          eq(purchaseOrderLines.poId, indent.poId),
          eq(purchaseOrderLines.indentId, indent.id)
        )
      )
      .limit(1);
    if (!poLine) continue;
    const qty = Number(indent.receivedQty) || 0;
    if (qty <= 0) continue;
    const rate = Number(poLine.newPrice || poLine.oldPrice) || 0;
    rawLines.push({
      source: "Raw_Material",
      poId: indent.poId,
      particular: indent.itemName,
      qty,
      rate,
      amount: round2(qty * rate),
    });
  }

  const generalPos = await db
    .select()
    .from(generalPurchaseOrders)
    .where(and(eq(generalPurchaseOrders.orgId, orgId), eq(generalPurchaseOrders.planId, planId)));
  const generalLines: JobCostingLine[] = [];
  for (const po of generalPos) {
    if (po.status === "Cancelled") continue;
    const lines = await loadLines(orgId, po.id);
    for (const line of lines) {
      generalLines.push({
        source: "General",
        poId: po.id,
        particular: line.particular,
        qty: line.qty,
        rate: line.rate,
        amount: line.amount,
      });
    }
  }

  const rawMaterialCost = round2(rawLines.reduce((sum, l) => sum + l.amount, 0));
  const generalCost = round2(generalLines.reduce((sum, l) => sum + l.amount, 0));

  return {
    planId,
    jobNo: plan.jobNo,
    productName: plan.productName,
    rawMaterialCost,
    generalCost,
    totalCost: round2(rawMaterialCost + generalCost),
    lines: [...rawLines, ...generalLines],
  };
}

/**
 * Renders a General PO PDF and uploads it — mirrors purchase/orders.ts's own
 * generatePoPdf()/poPdf.tsx layout exactly, reusing the same @react-pdf/renderer tree
 * with free-text particulars in place of SKU/itemName (there is no SKU here).
 */
export async function generateGeneralPoPdf(poId: string): Promise<{ url: string }> {
  const orgId = await getTenantOrgId();
  const po = await findById(generalPurchaseOrders, orgId, poId);
  if (!po) throw new GeneralPurchaseOrderError("PO nahi mila.");

  const vendor = await findById(vendors, orgId, po.vendorId);
  if (!vendor) throw new GeneralPurchaseOrderError("Vendor nahi mila.");

  const lines = await loadLines(orgId, poId);
  if (lines.length === 0) throw new GeneralPurchaseOrderError("PO me koi item nahi hai.");

  const { getQuotationSetup } = await import("@/lib/leads/quotationSetup");
  const { getSetting } = await import("@/lib/settings");
  const { uploadAttachment } = await import("@/lib/storage");
  const setup = await getQuotationSetup();
  const logoUrl = (await getSetting("ORG_LOGO_URL")) ?? "";
  const dateText = po.issuedAt.toLocaleDateString("en-IN");

  const subTotal = round2(lines.reduce((sum, l) => sum + l.qty * l.rate, 0));
  const gstPercent = Number(po.gstPercent) || 0;
  const gstAmount = round2((subTotal * gstPercent) / 100);
  const grandTotal = round2(subTotal + gstAmount);

  const { renderPurchaseOrderPdfBuffer } = await import("@/lib/purchase/poPdf");
  const buffer = await renderPurchaseOrderPdfBuffer(
    {
      poId: po.id,
      vendor: {
        name: vendor.vendorName,
        address: vendor.address,
        city: vendor.city,
        state: vendor.state,
        gstin: vendor.gstin,
        phone: vendor.phone,
        email: vendor.email,
      },
      lines: lines.map((l) => ({
        sku: "",
        itemName: l.particular + (l.description ? ` — ${l.description}` : ""),
        uom: l.uom,
        qty: l.qty,
        oldPrice: "",
        newPrice: String(l.rate),
      })),
      subTotal,
      gstPercent,
      gstAmount,
      grandTotal,
      termsAndConditions: po.termsAndConditions,
      note: po.note,
    },
    setup,
    logoUrl,
    dateText
  );

  const { url } = await uploadAttachment({
    fileName: `GPO_${po.id}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });

  await updateById(generalPurchaseOrders, orgId, poId, { attachmentUrl: url });
  return { url };
}
