import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { indents, purchaseOrderLines, purchaseOrders, vendors } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getVendorItemLink, listVendorsForSkus, type VendorSuggestion } from "@/lib/parties/vendorItems";
import { getPurchaseSetup } from "@/lib/purchase/settings";
import { computeDefaultTatDeadline, computeTatDeadline } from "@/lib/fms/calendar";
import { receiveIndent } from "@/lib/inventory/indents";

export class PurchaseOrderError extends Error {}

/** An Approved indent, not yet bundled into a PO, with every vendor known to supply it. */
export interface PurchaseCandidate {
  indentId: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  reason: string;
  approvedAt: string;
  vendors: VendorSuggestion[];
}

/**
 * Every Approved-but-unordered indent — Reorder and Production_Shortage alike, since both
 * still need a real vendor PO to actually happen — enriched with the vendors known to
 * supply that SKU (src/lib/parties/vendorItems.ts's own reorder-suggestion logic, reused
 * here so PO Issue and the Reorder board agree on who supplies what and at what price).
 */
export async function listPurchaseCandidates(): Promise<PurchaseCandidate[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(indents)
    .where(and(eq(indents.orgId, orgId), eq(indents.status, "Approved"), eq(indents.poId, "")));

  const skus = [...new Set(rows.map((r) => r.sku))];
  const vendorMap = await listVendorsForSkus(skus);

  return rows.map((r) => ({
    indentId: r.id,
    sku: r.sku,
    itemName: r.itemName,
    uom: r.uom,
    qty: Number(r.finalQty) || 0,
    reason: r.reason,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : "",
    vendors: vendorMap.get(r.sku) ?? [],
  }));
}

export interface PurchaseOrderLine {
  id: string;
  indentId: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  oldPrice: string;
  newPrice: string;
  indentStatus: string;
  receivedQty: string;
}

export interface PurchaseOrder {
  id: string;
  vendorId: string;
  vendorName: string;
  status: string;
  attachmentUrl: string;
  invoiceUrl: string;
  issuedBy: string;
  issuedAt: string;
  followUpDueAt: string;
  followUpDoneBy: string;
  followUpDoneAt: string;
  followUpRemark: string;
  materialReceivedDueAt: string;
  lines: PurchaseOrderLine[];
}

type PurchaseOrderRow = InferSelectModel<typeof purchaseOrders>;

function rowToPo(row: PurchaseOrderRow, vendorName: string, lines: PurchaseOrderLine[]): PurchaseOrder {
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName,
    status: row.status,
    attachmentUrl: row.attachmentUrl,
    invoiceUrl: row.invoiceUrl,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt.toISOString(),
    followUpDueAt: row.followUpDueAt ? row.followUpDueAt.toISOString() : "",
    followUpDoneBy: row.followUpDoneBy,
    followUpDoneAt: row.followUpDoneAt ? row.followUpDoneAt.toISOString() : "",
    followUpRemark: row.followUpRemark,
    materialReceivedDueAt: row.materialReceivedDueAt ? row.materialReceivedDueAt.toISOString() : "",
    lines,
  };
}

async function loadPoLines(orgId: string, poId: string): Promise<PurchaseOrderLine[]> {
  const lineRows = await db
    .select()
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.orgId, orgId), eq(purchaseOrderLines.poId, poId)));
  if (lineRows.length === 0) return [];

  const indentIds = lineRows.map((l) => l.indentId);
  const indentRows = await db
    .select()
    .from(indents)
    .where(and(eq(indents.orgId, orgId), inArray(indents.id, indentIds)));
  const indentMap = new Map(indentRows.map((i) => [i.id, i]));

  return lineRows.map((l) => {
    const indent = indentMap.get(l.indentId);
    return {
      id: l.id,
      indentId: l.indentId,
      sku: l.sku,
      itemName: indent?.itemName ?? "",
      uom: indent?.uom ?? "",
      qty: indent ? Number(indent.finalQty) || 0 : 0,
      oldPrice: l.oldPrice ?? "",
      newPrice: l.newPrice ?? "",
      indentStatus: indent?.status ?? "",
      receivedQty: indent?.receivedQty ?? "",
    };
  });
}

export async function getPurchaseOrder(poId: string): Promise<PurchaseOrder | null> {
  const orgId = await getTenantOrgId();
  const po = await findById(purchaseOrders, orgId, poId);
  if (!po) return null;
  const vendor = await findById(vendors, orgId, po.vendorId);
  const lines = await loadPoLines(orgId, poId);
  return rowToPo(po, vendor?.vendorName ?? "", lines);
}

export type PurchaseOrderStage = "follow_up" | "receiving" | "all";

/**
 * `follow_up` = Step 3 not yet done. `receiving` = Step 3 done, Step 4 (per-line
 * receiving) may still be open or fully closed out. `all` = every PO, any stage —
 * the flow's own history view.
 */
export async function listPurchaseOrders(stage: PurchaseOrderStage = "all"): Promise<PurchaseOrder[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(purchaseOrders).where(eq(purchaseOrders.orgId, orgId));

  const filtered = rows.filter((po) => {
    if (stage === "follow_up") return po.status === "Open" && !po.followUpDoneAt;
    if (stage === "receiving") return po.status === "Open" && Boolean(po.followUpDoneAt);
    return true;
  });

  const vendorIds = [...new Set(filtered.map((p) => p.vendorId))];
  const vendorRows =
    vendorIds.length > 0
      ? await db.select().from(vendors).where(and(eq(vendors.orgId, orgId), inArray(vendors.id, vendorIds)))
      : [];
  const vendorNameMap = new Map(vendorRows.map((v) => [v.id, v.vendorName]));

  const result: PurchaseOrder[] = [];
  for (const po of filtered) {
    const lines = await loadPoLines(orgId, po.id);
    result.push(rowToPo(po, vendorNameMap.get(po.vendorId) ?? "", lines));
  }

  return result.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

export interface CreatePurchaseOrderLineInput {
  indentId: string;
  /** Blank/undefined keeps the vendor's own last price (vendor_items.unitPrice). */
  newPrice?: number | null;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  lines: CreatePurchaseOrderLineInput[];
  attachmentUrl: string;
  issuedBy: string;
}

/**
 * Issues a PO — always to exactly one vendor, bundling every Approved indent named in
 * `input.lines` that this vendor is actually linked to supply.
 *
 * Every line is validated before anything is written — no partial PO from a bad line
 * three items in. Step 3 and Step 4's deadlines both key off the *slowest* item in the
 * PO (max Lead Time across every line's vendor_items link), since the PO as a whole isn't
 * done until its slowest item arrives.
 */
export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  if (input.lines.length === 0) {
    throw new PurchaseOrderError("Kam se kam ek item chunein.");
  }
  if (!input.attachmentUrl.trim()) {
    throw new PurchaseOrderError("PO attachment zaroori hai.");
  }

  const orgId = await getTenantOrgId();
  const vendor = await findById(vendors, orgId, input.vendorId);
  if (!vendor) {
    throw new PurchaseOrderError("Vendor nahi mila.");
  }

  const resolved: {
    indentId: string;
    sku: string;
    oldPrice: string;
    newPrice: string;
    leadTimeDays: number;
  }[] = [];

  for (const line of input.lines) {
    const indent = await findById(indents, orgId, line.indentId);
    if (!indent) {
      throw new PurchaseOrderError(`Indent ${line.indentId} nahi mila.`);
    }
    if (indent.status !== "Approved") {
      throw new PurchaseOrderError(`${indent.itemName} ka indent "${indent.status}" hai, "Approved" nahi.`);
    }
    if (indent.poId) {
      throw new PurchaseOrderError(`${indent.itemName} pehle se ek PO me hai.`);
    }

    const link = await getVendorItemLink(input.vendorId, indent.sku);
    if (!link) {
      throw new PurchaseOrderError(`${vendor.vendorName} "${indent.itemName}" supply nahi karta.`);
    }

    resolved.push({
      indentId: indent.id,
      sku: indent.sku,
      oldPrice: link.unitPrice,
      newPrice:
        line.newPrice !== undefined && line.newPrice !== null ? String(line.newPrice) : link.unitPrice,
      leadTimeDays: link.leadTimeDays ?? 0,
    });
  }

  const maxLeadDays = Math.max(...resolved.map((r) => r.leadTimeDays));
  const purchaseSetup = await getPurchaseSetup();
  const issuedAt = Date.now();

  const followUpDays = Math.max(maxLeadDays - 1, 0);
  const followUpDueAtMs = purchaseSetup.step3Doer
    ? await computeTatDeadline(purchaseSetup.step3Doer, issuedAt, followUpDays, "Days")
    : await computeDefaultTatDeadline(issuedAt, followUpDays, "Days");

  const materialReceivedDueAtMs = purchaseSetup.step4Doer
    ? await computeTatDeadline(purchaseSetup.step4Doer, issuedAt, maxLeadDays, "Days")
    : await computeDefaultTatDeadline(issuedAt, maxLeadDays, "Days");

  const poId = generateId("PO");
  await insertRecord(purchaseOrders, {
    id: poId,
    orgId,
    vendorId: input.vendorId,
    status: "Open",
    attachmentUrl: input.attachmentUrl,
    issuedBy: input.issuedBy,
    issuedAt: new Date(issuedAt),
    followUpDueAt: new Date(followUpDueAtMs),
    materialReceivedDueAt: new Date(materialReceivedDueAtMs),
  });

  // Sequential, not db.batch(): each line's own insert plus its indent's status flip is
  // two statements, and neon-http's batch() only atomically groups a single call's own
  // list — the same one-by-one convention the rest of this codebase's multi-row creates
  // already use (e.g. createVendorsBulk).
  for (const line of resolved) {
    await insertRecord(purchaseOrderLines, {
      id: generateId("POL"),
      orgId,
      poId,
      indentId: line.indentId,
      sku: line.sku,
      oldPrice: line.oldPrice || null,
      newPrice: line.newPrice || null,
    });
    await updateById(indents, orgId, line.indentId, { status: "Ordered", poId });
  }

  const created = await getPurchaseOrder(poId);
  if (!created) throw new PurchaseOrderError("PO ban gaya lekin load nahi ho paya.");
  return created;
}

/** Step 3 — a real action the assigned Doer marks done, not a passive reminder. */
export async function markFollowUpDone(
  poId: string,
  userId: string,
  remark: string
): Promise<PurchaseOrder> {
  const orgId = await getTenantOrgId();
  const po = await findById(purchaseOrders, orgId, poId);
  if (!po) throw new PurchaseOrderError("PO nahi mila.");
  if (po.status !== "Open") throw new PurchaseOrderError(`Ye PO "${po.status}" hai.`);
  if (po.followUpDoneAt) throw new PurchaseOrderError("Follow-up pehle se ho chuka hai.");

  await updateById(purchaseOrders, orgId, poId, {
    followUpDoneBy: userId,
    followUpDoneAt: new Date(),
    followUpRemark: remark,
  });

  const updated = await getPurchaseOrder(poId);
  if (!updated) throw new PurchaseOrderError("PO update ho gaya lekin load nahi ho paya.");
  return updated;
}

/**
 * Step 4 — receives one line's quantity (partial or full), reusing the exact same
 * `receiveIndent()` the plain Indents board already uses, so stock writes and partial-vs-
 * full accounting stay identical in both places. Blocked until Step 3 is done, matching
 * every other FMS flow's convention that a step stays un-actionable until its predecessor
 * completes.
 */
export async function receivePurchaseOrderLine(
  poId: string,
  indentId: string,
  receivedQty: number,
  userId: string,
  invoiceUrl?: string
): Promise<PurchaseOrder> {
  const orgId = await getTenantOrgId();
  const po = await findById(purchaseOrders, orgId, poId);
  if (!po) throw new PurchaseOrderError("PO nahi mila.");
  if (!po.followUpDoneAt) {
    throw new PurchaseOrderError("Pehle Follow-up complete karein, tabhi receive kar sakte hain.");
  }

  const [line] = await db
    .select()
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.orgId, orgId),
        eq(purchaseOrderLines.poId, poId),
        eq(purchaseOrderLines.indentId, indentId)
      )
    )
    .limit(1);
  if (!line) throw new PurchaseOrderError("Ye item is PO me nahi hai.");

  await receiveIndent(indentId, receivedQty, userId);

  if (invoiceUrl && !po.invoiceUrl) {
    await updateById(purchaseOrders, orgId, poId, { invoiceUrl });
  }

  const allLines = await loadPoLines(orgId, poId);
  const allReceived = allLines.every((l) => l.indentStatus === "Received");
  if (allReceived) {
    await updateById(purchaseOrders, orgId, poId, { status: "Completed" });
  }

  const updated = await getPurchaseOrder(poId);
  if (!updated) throw new PurchaseOrderError("PO update ho gaya lekin load nahi ho paya.");
  return updated;
}
