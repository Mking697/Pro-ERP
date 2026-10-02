import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listCustomers } from "@/lib/parties/customers";
import { listVendors } from "@/lib/parties/vendors";
import { listOrders } from "@/lib/orders/orders";
import { listItems } from "@/lib/inventory/items";
import { listLeads } from "@/lib/leads/leads";

/**
 * Global search / command-palette backend (Cmd+K, see command-palette.tsx).
 *
 * Deliberately NOT a new search index or SQL ILIKE query across tables — every list here
 * is already read in full by its own page today (Parties, Orders, Inventory, Leads all
 * load their full org-scoped list client-side), so this reuses those exact same
 * already-access-checked functions and filters the result in memory. A genuinely large
 * org (tens of thousands of rows per module) would want a real indexed search instead,
 * but none of this codebase's existing list reads do that today either — this endpoint
 * stays consistent with that, not a new performance cliff.
 *
 * Each module is skipped outright (not just filtered down) when the asking user lacks the
 * matching grant — same access boundary every page/API route already enforces, mirrored
 * here rather than re-derived.
 */

export interface SearchResult {
  kind: "customer" | "vendor" | "order" | "item" | "lead";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const MAX_PER_KIND = 6;

function matches(haystack: string[], query: string): boolean {
  const q = query.toLowerCase();
  return haystack.some((h) => h && h.toLowerCase().includes(q));
}

export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length < 2) {
    return NextResponse.json({ results: [] satisfies SearchResult[] });
  }

  const access = guard.session.access;
  const results: SearchResult[] = [];

  const tasks: Promise<void>[] = [];

  if (access.includes("PARTY_MASTER")) {
    tasks.push(
      listCustomers().then((rows) => {
        for (const c of rows) {
          if (results.filter((r) => r.kind === "customer").length >= MAX_PER_KIND) break;
          if (matches([c.Customer_Name, c.Contact_Person, c.Phone, c.Email, c.GSTIN], query)) {
            results.push({
              kind: "customer",
              id: c.Customer_ID,
              title: c.Customer_Name,
              subtitle: c.Contact_Person || c.Phone || "Customer",
              href: "/parties",
            });
          }
        }
      })
    );
    tasks.push(
      listVendors().then((rows) => {
        for (const v of rows) {
          if (results.filter((r) => r.kind === "vendor").length >= MAX_PER_KIND) break;
          if (matches([v.Vendor_Name, v.Contact_Person, v.Phone, v.Email, v.GSTIN], query)) {
            results.push({
              kind: "vendor",
              id: v.Vendor_ID,
              title: v.Vendor_Name,
              subtitle: v.Contact_Person || v.Phone || "Vendor",
              href: "/parties",
            });
          }
        }
      })
    );
  }

  if (access.includes("ORDER_FMS")) {
    tasks.push(
      listOrders().then((rows) => {
        for (const o of rows) {
          if (results.filter((r) => r.kind === "order").length >= MAX_PER_KIND) break;
          if (matches([o.id, o.partyName, o.contactPerson, o.customerMobile], query)) {
            results.push({
              kind: "order",
              id: o.id,
              title: o.id,
              subtitle: `${o.partyName} — ${o.status}`,
              href: "/orders",
            });
          }
        }
      })
    );
  }

  if (access.includes("INVENTORY_VIEW")) {
    tasks.push(
      listItems().then((rows) => {
        for (const i of rows) {
          if (results.filter((r) => r.kind === "item").length >= MAX_PER_KIND) break;
          if (matches([i.SKU, i.Item_Name], query)) {
            results.push({
              kind: "item",
              id: i.SKU,
              title: i.SKU,
              subtitle: i.Item_Name,
              href: `/inventory/${encodeURIComponent(i.SKU)}`,
            });
          }
        }
      })
    );
  }

  if (access.includes("LEAD_FMS")) {
    tasks.push(
      listLeads().then((rows) => {
        for (const l of rows) {
          if (results.filter((r) => r.kind === "lead").length >= MAX_PER_KIND) break;
          if (matches([l.personName, l.companyName, l.phone, l.email], query)) {
            results.push({
              kind: "lead",
              id: l.id,
              title: l.personName,
              subtitle: l.companyName || l.status,
              href: "/leads",
            });
          }
        }
      })
    );
  }

  await Promise.all(tasks);

  return NextResponse.json({ results });
}
