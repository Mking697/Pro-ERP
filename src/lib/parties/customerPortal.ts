import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { customerPortalLinks, invoices } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";
import { listOrdersForCustomer } from "@/lib/orders/orders";

/**
 * Customer Portal magic links — see src/db/schema/platform.ts's own header comment on
 * `customerPortalLinks` for why this lives in the platform registry rather than a
 * per-org table. One token per Customer (not per order), permanent until a staff member
 * explicitly regenerates it — a repeat customer never needs a fresh link per purchase,
 * and a one-time buyer never needs an account at all.
 */

/** 24 random bytes, url-safe — same strength/shape as report_shares' own token
 * (src/lib/platform/shares.ts) since both are "the link IS the credential". */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The existing link for this customer, or null if none has been generated yet. */
export async function getPortalLink(customerId: string): Promise<string | null> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({ token: customerPortalLinks.token })
    .from(customerPortalLinks)
    .where(and(eq(customerPortalLinks.orgId, orgId), eq(customerPortalLinks.customerId, customerId)))
    .limit(1);
  return rows[0]?.token ?? null;
}

/** Returns this customer's existing token, or mints and stores a new one. Idempotent —
 * safe to call every time the "Portal Link" dialog opens. */
export async function getOrCreatePortalLink(customerId: string, createdBy: string): Promise<string> {
  const existing = await getPortalLink(customerId);
  if (existing) return existing;

  const orgId = await getTenantOrgId();
  const token = newToken();
  await db
    .insert(customerPortalLinks)
    .values({ token, orgId, customerId, createdBy })
    // A concurrent double-click could race two inserts for the same customer; the unique
    // (org_id, customer_id) constraint is the real guard — on conflict, re-read whichever
    // row actually landed rather than erroring the second caller.
    .onConflictDoNothing({ target: [customerPortalLinks.orgId, customerPortalLinks.customerId] });

  return (await getPortalLink(customerId)) ?? token;
}

/** Deletes the old link (if any) and mints a fresh one — for when a link may have leaked.
 * The old token stops resolving the instant this commits, same as revokeReportShare(). */
export async function regeneratePortalLink(customerId: string, createdBy: string): Promise<string> {
  const orgId = await getTenantOrgId();
  const token = newToken();
  await db
    .delete(customerPortalLinks)
    .where(and(eq(customerPortalLinks.orgId, orgId), eq(customerPortalLinks.customerId, customerId)));
  await db.insert(customerPortalLinks).values({ token, orgId, customerId, createdBy });
  return token;
}

export interface PortalSession {
  orgId: string;
  customerId: string;
}

/**
 * Resolves a token with no session/org context at all — a portal visitor holds nothing
 * but the token, exactly like `getReportShare()`. Deliberately scoped by `token` alone;
 * never add an implicit org filter here.
 */
export async function resolvePortalToken(token: string): Promise<PortalSession | null> {
  if (!token) return null;
  const rows = await db
    .select({ orgId: customerPortalLinks.orgId, customerId: customerPortalLinks.customerId })
    .from(customerPortalLinks)
    .where(eq(customerPortalLinks.token, token))
    .limit(1);
  return rows[0] ?? null;
}

export interface PortalOrder {
  id: string;
  status: string;
  orderValue: number;
  createdAt: string;
  items: { itemName: string; sku: string; qty: number; uom: string }[];
  invoices: { id: string; invoiceNo: string; finalValue: number; attachmentUrl: string; issuedAt: string | null }[];
}

/**
 * The read-only data the `/portal/[token]` page shows — this customer's own Orders only
 * (never another customer's, never internal-only fields like margins/vendor cost), each
 * with its Issued invoices (never a Draft one — a customer has no business seeing a bill
 * that hasn't actually been issued yet). Must be called inside `runWithTenant(tenant, ...)`
 * since it reads through the normal tenant-scoped helpers, not the token-only resolver.
 */
export async function getPortalOrders(customerId: string): Promise<PortalOrder[]> {
  const orders = await listOrdersForCustomer(customerId);
  if (orders.length === 0) return [];

  const orgId = await getTenantOrgId();
  const invoiceRows = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.orgId, orgId),
        eq(invoices.status, "Issued"),
        inArray(invoices.orderId, orders.map((o) => o.id))
      )
    );

  return orders
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((order) => ({
      id: order.id,
      status: order.status,
      orderValue: order.orderValue,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        itemName: i.itemName,
        sku: i.sku,
        qty: i.qty,
        uom: i.uom,
      })),
      invoices: invoiceRows
        .filter((inv) => inv.orderId === order.id)
        .map((inv) => ({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          finalValue: Number(inv.finalValue),
          attachmentUrl: inv.invoiceAttachmentUrl,
          issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
        })),
    }));
}
