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
import { getSetting } from "@/lib/settings";
import { uploadAttachment } from "@/lib/storage";
import { getQuotationSetup } from "@/lib/leads/quotationSetup";

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
  /** Blank is only allowed when `generateAttachment` is true — see below. */
  attachmentUrl: string;
  /** When true and `attachmentUrl` is blank, a system-generated PDF (same layout
   *  `generatePoPdf()`/`previewPoPdf()` below render) is attached automatically right after
   *  the PO row is created, instead of requiring a manually uploaded file. The "PO needs an
   *  attachment" rule itself is unchanged — this only adds a second way to satisfy it. */
  generateAttachment?: boolean;
  issuedBy: string;
}

interface ResolvedPoLine {
  indentId: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  oldPrice: string;
  newPrice: string;
  leadTimeDays: number;
}

/**
 * Validates and resolves every candidate line against the chosen vendor — shared by
 * `createPurchaseOrder()` (which then writes the rows) and `previewPoPdf()` (which only
 * needs the same resolved data to render a draft document, before anything is written).
 * Every line is checked before anything is written by either caller — no partial PO, and
 * no preview built from a line that couldn't actually be ordered.
 */
async function resolvePoLines(
  orgId: string,
  vendorId: string,
  lines: CreatePurchaseOrderLineInput[]
): Promise<{ vendor: InferSelectModel<typeof vendors>; resolved: ResolvedPoLine[] }> {
  const vendor = await findById(vendors, orgId, vendorId);
  if (!vendor) {
    throw new PurchaseOrderError("Vendor nahi mila.");
  }

  const resolved: ResolvedPoLine[] = [];
  for (const line of lines) {
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

    const link = await getVendorItemLink(vendorId, indent.sku);
    if (!link) {
      throw new PurchaseOrderError(`${vendor.vendorName} "${indent.itemName}" supply nahi karta.`);
    }

    resolved.push({
      indentId: indent.id,
      sku: indent.sku,
      itemName: indent.itemName,
      uom: indent.uom,
      qty: Number(indent.finalQty) || 0,
      oldPrice: link.unitPrice,
      newPrice:
        line.newPrice !== undefined && line.newPrice !== null ? String(line.newPrice) : link.unitPrice,
      leadTimeDays: link.leadTimeDays ?? 0,
    });
  }
  return { vendor, resolved };
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
  const attachmentUrl = input.attachmentUrl.trim();
  if (!attachmentUrl && !input.generateAttachment) {
    throw new PurchaseOrderError("PO attachment zaroori hai.");
  }

  const orgId = await getTenantOrgId();
  const { resolved } = await resolvePoLines(orgId, input.vendorId, input.lines);

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
    attachmentUrl,
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

  if (input.generateAttachment && !attachmentUrl) {
    // The row now exists for real, so generatePoPdf() (below) can render against its actual
    // saved data and set attachmentUrl itself. If it throws (a rendering error, Blob being
    // unavailable, ...), the PO and its lines are already committed above — neon-http has no
    // cross-call transaction to roll them back into, same as every other multi-statement
    // sequential write in this file (see the "Sequential, not db.batch()" comment above).
    // Rather than let a bare exception look like "nothing happened" when a real PO+lines now
    // exist and the indent is already marked Ordered, name the PO so the caller can recover —
    // either by retrying POST /api/purchase/orders/[poId]/generate-pdf, or by manually
    // uploading and PATCHing attachmentUrl in some future screen.
    try {
      await generatePoPdf(poId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new PurchaseOrderError(
        `PO ${poId} ban gaya hai (items reserve ho chuke hain), lekin PDF generate nahi ho paya: ${message}. ` +
          `Dobara PDF generate karne ki koshish karein (PO ID: ${poId}).`
      );
    }
  }

  const created = await getPurchaseOrder(poId);
  if (!created) throw new PurchaseOrderError("PO ban gaya lekin load nahi ho paya.");
  return created;
}

/**
 * Renders a PO PDF and uploads it via Blob — used two ways: (1) `createPurchaseOrder()`
 * above calls this right after inserting a new PO row, when the purchaser chose
 * auto-generate instead of a manual upload; (2) the standalone
 * `/api/purchase/orders/[poId]/generate-pdf` route calls it directly to (re)generate the
 * document for a PO that already exists — e.g. to replace a manually uploaded scan with a
 * proper one later. Either way it always renders from the PO's own saved rows, never from
 * a caller-supplied draft, and always overwrites `attachmentUrl` with the result.
 *
 * Mirrors src/lib/leads/quotations.ts's own renderQuotationPdf(): the @react-pdf/renderer
 * tree (`poPdf.tsx`) is imported dynamically, here alone, so nothing else in this file has
 * to resolve that dependency tree.
 */
export async function generatePoPdf(poId: string): Promise<{ url: string }> {
  const orgId = await getTenantOrgId();
  const po = await findById(purchaseOrders, orgId, poId);
  if (!po) throw new PurchaseOrderError("PO nahi mila.");

  const vendor = await findById(vendors, orgId, po.vendorId);
  if (!vendor) throw new PurchaseOrderError("Vendor nahi mila.");

  const lines = await loadPoLines(orgId, poId);
  if (lines.length === 0) throw new PurchaseOrderError("PO me koi item nahi hai.");

  const setup = await getQuotationSetup();
  const logoUrl = (await getSetting("ORG_LOGO_URL")) ?? "";
  const dateText = po.issuedAt.toLocaleDateString("en-IN");

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
        sku: l.sku,
        itemName: l.itemName,
        uom: l.uom,
        qty: l.qty,
        oldPrice: l.oldPrice,
        newPrice: l.newPrice,
      })),
    },
    setup,
    logoUrl,
    dateText
  );

  const { url } = await uploadAttachment({
    fileName: `PO_${po.id}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });

  await updateById(purchaseOrders, orgId, poId, { attachmentUrl: url });
  return { url };
}

export interface PreviewPoPdfInput {
  vendorId: string;
  lines: CreatePurchaseOrderLineInput[];
}

/**
 * Renders a DRAFT PO PDF from the purchaser's current vendor+line selection on the PO Issue
 * screen — before any `purchase_orders` row exists (that screen picks a vendor and its
 * candidate indents, then only creates the real PO once "PO Issue karein" is clicked).
 * Writes nothing to the database (no PO, no lines, no indent status change) — it exists
 * purely so the resulting URL can sit in the same `attachmentUrl` slot a manually uploaded
 * file would, letting `createPurchaseOrder()` treat the two identically once Issue is
 * actually clicked. The PDF itself shows "Draft" in place of a real PO number, since one
 * hasn't been allocated yet.
 */
export async function previewPoPdf(input: PreviewPoPdfInput): Promise<{ url: string }> {
  const orgId = await getTenantOrgId();
  const { vendor, resolved } = await resolvePoLines(orgId, input.vendorId, input.lines);
  if (resolved.length === 0) {
    throw new PurchaseOrderError("Kam se kam ek item chunein.");
  }

  const setup = await getQuotationSetup();
  const logoUrl = (await getSetting("ORG_LOGO_URL")) ?? "";
  const dateText = new Date().toLocaleDateString("en-IN");

  const { renderPurchaseOrderPdfBuffer } = await import("@/lib/purchase/poPdf");
  const buffer = await renderPurchaseOrderPdfBuffer(
    {
      poId: "Draft",
      vendor: {
        name: vendor.vendorName,
        address: vendor.address,
        city: vendor.city,
        state: vendor.state,
        gstin: vendor.gstin,
        phone: vendor.phone,
        email: vendor.email,
      },
      lines: resolved.map((r) => ({
        sku: r.sku,
        itemName: r.itemName,
        uom: r.uom,
        qty: r.qty,
        oldPrice: r.oldPrice,
        newPrice: r.newPrice,
      })),
    },
    setup,
    logoUrl,
    dateText
  );

  return uploadAttachment({
    fileName: `PO_Draft_${Date.now()}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });
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
