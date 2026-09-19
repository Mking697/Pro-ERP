import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { items, vendorItems, vendors } from "@/db/schema";
import { db } from "@/db/client";
import { insertRecord, updateById, deleteById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * One Purchase Vendor's price/lead-time for one SKU — the link a plain Vendor row can't
 * carry, since a vendor supplies several items and an item can come from several vendors.
 */
export interface VendorItemRecord {
  Vendor_Item_ID: string;
  Vendor_ID: string;
  SKU: string;
  Item_Name: string;
  UOM: string;
  Lead_Time_Days: string;
  Unit_Price: string;
  Created_At: string;
}

/** One row of the vendor list an Indent suggests for a SKU, cheapest first. */
export interface VendorSuggestion {
  vendorId: string;
  vendorName: string;
  leadTimeDays: string;
  unitPrice: string;
}

type VendorItemRow = InferSelectModel<typeof vendorItems>;

function rowToRecord(row: VendorItemRow, itemName = "", uom = ""): VendorItemRecord {
  return {
    Vendor_Item_ID: row.id,
    Vendor_ID: row.vendorId,
    SKU: row.sku,
    Item_Name: itemName,
    UOM: uom,
    Lead_Time_Days: row.leadTimeDays === null ? "" : String(row.leadTimeDays),
    Unit_Price: row.unitPrice ?? "",
    Created_At: row.createdAt.toISOString(),
  };
}

/** number|null|undefined -> a `numeric`/`integer` column's insert/update value. */
function numericCol(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Every item a given vendor is linked to, for the vendor's own "Items" dialog — joined
 * against `items` for a display name/unit, since `vendor_items` itself only stores the SKU.
 */
export async function listVendorItems(vendorId: string): Promise<VendorItemRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({ link: vendorItems, itemName: items.itemName, uom: items.uom })
    .from(vendorItems)
    .leftJoin(items, eq(vendorItems.sku, items.sku))
    .where(and(eq(vendorItems.orgId, orgId), eq(vendorItems.vendorId, vendorId)));
  return rows.map((r) => rowToRecord(r.link, r.itemName ?? "", r.uom ?? ""));
}

/**
 * One vendor's own link to one SKU — its lead time and current price — or null if this
 * vendor doesn't actually supply that item. What Purchase's PO Issue step checks before
 * letting an item onto a PO (see src/lib/purchase/orders.ts).
 */
export async function getVendorItemLink(
  vendorId: string,
  sku: string
): Promise<{ leadTimeDays: number | null; unitPrice: string } | null> {
  const orgId = await getTenantOrgId();
  const [row] = await db
    .select()
    .from(vendorItems)
    .where(
      and(eq(vendorItems.orgId, orgId), eq(vendorItems.vendorId, vendorId), eq(vendorItems.sku, sku))
    )
    .limit(1);
  if (!row) return null;
  return { leadTimeDays: row.leadTimeDays, unitPrice: row.unitPrice ?? "" };
}

/**
 * Every Active vendor supplying a SKU, cheapest unit price first (a vendor with no price
 * set yet sorts last, not first — an unset price is not "free"). This is what the reorder
 * board suggests when an indent is about to be raised for that item.
 */
export async function listVendorsForSku(sku: string): Promise<VendorSuggestion[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({
      vendorId: vendorItems.vendorId,
      vendorName: vendors.vendorName,
      leadTimeDays: vendorItems.leadTimeDays,
      unitPrice: vendorItems.unitPrice,
    })
    .from(vendorItems)
    .innerJoin(vendors, eq(vendorItems.vendorId, vendors.id))
    .where(
      and(eq(vendorItems.orgId, orgId), eq(vendorItems.sku, sku), eq(vendors.status, "Active"))
    );

  return rows
    .map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      leadTimeDays: r.leadTimeDays === null ? "" : String(r.leadTimeDays),
      unitPrice: r.unitPrice ?? "",
    }))
    .sort((a, b) => {
      const pa = a.unitPrice === "" ? null : Number(a.unitPrice);
      const pb = b.unitPrice === "" ? null : Number(b.unitPrice);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    });
}

/**
 * Same as {@link listVendorsForSku}, batched for every SKU on the reorder board in one
 * query instead of one round trip per row.
 */
export async function listVendorsForSkus(
  skus: string[]
): Promise<Map<string, VendorSuggestion[]>> {
  const result = new Map<string, VendorSuggestion[]>();
  if (skus.length === 0) return result;

  const orgId = await getTenantOrgId();
  const rows = await db
    .select({
      sku: vendorItems.sku,
      vendorId: vendorItems.vendorId,
      vendorName: vendors.vendorName,
      leadTimeDays: vendorItems.leadTimeDays,
      unitPrice: vendorItems.unitPrice,
    })
    .from(vendorItems)
    .innerJoin(vendors, eq(vendorItems.vendorId, vendors.id))
    .where(
      and(eq(vendorItems.orgId, orgId), inArray(vendorItems.sku, skus), eq(vendors.status, "Active"))
    );

  for (const row of rows) {
    const list = result.get(row.sku) ?? [];
    list.push({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      leadTimeDays: row.leadTimeDays === null ? "" : String(row.leadTimeDays),
      unitPrice: row.unitPrice ?? "",
    });
    result.set(row.sku, list);
  }

  for (const [sku, list] of result) {
    list.sort((a, b) => {
      const pa = a.unitPrice === "" ? null : Number(a.unitPrice);
      const pb = b.unitPrice === "" ? null : Number(b.unitPrice);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    });
    result.set(sku, list);
  }

  return result;
}

export interface UpsertVendorItemInput {
  vendorId: string;
  sku: string;
  leadTimeDays?: number | null;
  unitPrice?: number | null;
  createdBy: string;
}

/**
 * Adds a vendor↔item link, or — if this vendor is already linked to this SKU — updates
 * its lead time/price instead of erroring on the unique constraint. Re-linking an
 * existing pair is the normal way a price gets refreshed, not an edge case to reject.
 */
export async function upsertVendorItem(input: UpsertVendorItemInput): Promise<VendorItemRecord> {
  const orgId = await getTenantOrgId();

  const [existing] = await db
    .select()
    .from(vendorItems)
    .where(
      and(
        eq(vendorItems.orgId, orgId),
        eq(vendorItems.vendorId, input.vendorId),
        eq(vendorItems.sku, input.sku)
      )
    )
    .limit(1);

  if (existing) {
    const updated = await updateById(vendorItems, orgId, existing.id, {
      leadTimeDays: input.leadTimeDays ?? null,
      unitPrice: numericCol(input.unitPrice),
    });
    if (!updated) throw new Error("Vendor-Item link nahi mila.");
    return rowToRecord(updated);
  }

  const row = await insertRecord(vendorItems, {
    id: generateId("VIT"),
    orgId,
    vendorId: input.vendorId,
    sku: input.sku,
    leadTimeDays: input.leadTimeDays ?? null,
    unitPrice: numericCol(input.unitPrice),
    createdBy: input.createdBy,
  });
  return rowToRecord(row);
}

export async function deleteVendorItem(vendorItemId: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  return deleteById(vendorItems, orgId, vendorItemId);
}
