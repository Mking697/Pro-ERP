import { NextResponse } from "next/server";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { customers, vendors, orders, items, leads } from "@/db/schema";
import { requireSession } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";

export interface SearchResult {
  kind: "customer" | "vendor" | "order" | "item" | "lead";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
const PAGE_SIZE = 6;

/** Bounded transfer, not an index claim: substring ILIKE may still scan a tenant.
 * Stable unique-id ordering and one lookahead row per allowed kind; no detail hydration.
 * Page offsets are bounded; concurrent inserts may shift offsets (not snapshot paging). */
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const pageText = url.searchParams.get("page") ?? "0";
  if (!/^\d+$/.test(pageText) || Number(pageText) > 1000 || query.length > 200) {
    return NextResponse.json({ error: "Invalid search query or page." }, { status: 400 });
  }
  const page = Number(pageText);
  if (query.length < 2) return NextResponse.json({ results: [], page, hasMore: false });
  const orgId = await getTenantOrgId();
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const access = guard.session.access;
  const pending: Promise<SearchResult[]>[] = [];
  let hasMore = false;
  const collect = async (kind: SearchResult["kind"], rows: PromiseLike<{ id: string; title: string; subtitle: string }[]>, href: string) => {
    const matches = await rows;
    if (matches.length > PAGE_SIZE) hasMore = true;
    return matches.slice(0, PAGE_SIZE).map(row => ({ ...row, kind,
      href: kind === "item" ? `/inventory/${encodeURIComponent(row.id)}` : href }));
  };
  if (access.includes("PARTY_MASTER")) {
    pending.push(collect("customer", db.select({ id: customers.id, title: customers.customerName,
      subtitle: sql<string>`coalesce(nullif(${customers.contactPerson}, ''), nullif(${customers.phone}, ''), 'Customer')` })
      .from(customers).where(and(eq(customers.orgId, orgId), or(...[customers.customerName, customers.contactPerson, customers.phone, customers.email, customers.gstin].map(c => ilike(c, pattern)))))
      .orderBy(asc(customers.id)).limit(PAGE_SIZE + 1).offset(page * PAGE_SIZE), "/parties"));
    pending.push(collect("vendor", db.select({ id: vendors.id, title: vendors.vendorName,
      subtitle: sql<string>`coalesce(nullif(${vendors.contactPerson}, ''), nullif(${vendors.phone}, ''), 'Vendor')` })
      .from(vendors).where(and(eq(vendors.orgId, orgId), or(...[vendors.vendorName, vendors.contactPerson, vendors.phone, vendors.email, vendors.gstin].map(c => ilike(c, pattern)))))
      .orderBy(asc(vendors.id)).limit(PAGE_SIZE + 1).offset(page * PAGE_SIZE), "/parties"));
  }
  if (access.includes("ORDER_FMS")) pending.push(collect("order", db.select({ id: orders.id, title: orders.id,
    subtitle: sql<string>`${orders.partyName} || ' — ' || ${orders.status}` }).from(orders)
    .where(and(eq(orders.orgId, orgId), or(...[orders.id, orders.partyName, orders.contactPerson, orders.customerMobile].map(c => ilike(c, pattern)))))
    .orderBy(asc(orders.id)).limit(PAGE_SIZE + 1).offset(page * PAGE_SIZE), "/orders"));
  if (access.includes("INVENTORY_VIEW")) pending.push(collect("item", db.select({ id: items.sku, title: items.sku, subtitle: items.itemName }).from(items)
    .where(and(eq(items.orgId, orgId), or(ilike(items.sku, pattern), ilike(items.itemName, pattern))))
    .orderBy(asc(items.sku)).limit(PAGE_SIZE + 1).offset(page * PAGE_SIZE), "/inventory"));
  if (access.includes("LEAD_FMS")) pending.push(collect("lead", db.select({ id: leads.id, title: leads.personName,
    subtitle: sql<string>`coalesce(nullif(${leads.companyName}, ''), ${leads.status}::text)` }).from(leads)
    .where(and(eq(leads.orgId, orgId), or(...[leads.personName, leads.companyName, leads.phone, leads.email].map(c => ilike(c, pattern)))))
    .orderBy(asc(leads.id)).limit(PAGE_SIZE + 1).offset(page * PAGE_SIZE), "/leads"));
  const results = (await Promise.all(pending)).flat();
  return NextResponse.json({ results, page, hasMore });
}

