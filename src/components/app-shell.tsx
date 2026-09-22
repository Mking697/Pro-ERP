import Link from "next/link";
import { getOrganization } from "@/lib/platform/registry";
import type { SessionPayload } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import NavLinks, { type NavEntry, type NavItem } from "@/components/nav-links";
import LogoutButton from "@/app/dashboard/logout-button";
import { isPlatformAdmin } from "@/lib/platform/admin";
import { getSetting } from "@/lib/settings";
import { OrgLogo } from "@/components/logo-picker";
import SettingsMenu from "@/components/settings-menu";
import ChangelogMenu from "@/components/changelog-menu";
import { listNavFmsTemplates } from "@/lib/fms/templates";
import { listUsedFmsTemplateIds } from "@/lib/inventory/plans";
import { tenantCached } from "@/lib/cache";

/**
 * The frame every signed-in page sits inside.
 *
 * Before this, only /admin had navigation — from /tasks or /inward the only way out was
 * the browser back button. The bar is built from the user's own grants, so it never
 * offers a link to a page that would just bounce them.
 */
export default async function AppShell({
  session,
  children,
}: {
  session: SessionPayload;
  children: React.ReactNode;
}) {
  const org = await getOrganization(session.orgId);
  // Settings are cached per org, so this costs nothing after the first page view.
  const logoUrl = await getSetting("ORG_LOGO_URL").catch(() => null);

  const isFmsAdmin = session.access.includes("FMS_ADMIN");
  // One extra nav item per Active FMS template this user is entitled to open as its own
  // Flow Board — every Active template for an FMS_ADMIN, or only the ones whose static
  // step design assigns this user otherwise (see listNavFmsTemplates). Cached per org
  // (shared across every admin, since they all see the same set) because this runs on
  // every single page load; a broken/unconnected FMS sheet must never break navigation
  // for the rest of the app, same reasoning as the ORG_LOGO_URL read just above.
  const navFmsTemplates = await tenantCached(
    session.orgId,
    `nav-fms-templates:${isFmsAdmin ? "admin" : session.userId}`,
    60_000,
    () => listNavFmsTemplates(session.userId, isFmsAdmin)
  ).catch(() => []);

  // A "PMS" Line's own default trigger is "MANUAL" (see api/ppc/production-lines/route.ts),
  // so Trigger_Event alone can't tell a PPC-connected Line apart from every other FMS flow
  // — actually being chosen by a production plan can. Same caching reasoning as above.
  const usedFmsTemplateIds = await tenantCached(
    session.orgId,
    "nav-used-fms-template-ids",
    60_000,
    () => listUsedFmsTemplateIds()
  ).catch(() => new Set<string>());

  const pmsFmsTemplates = navFmsTemplates.filter(
    (tpl) => tpl.triggerEvent === "PRODUCTION_STARTED" || usedFmsTemplateIds.has(tpl.templateId)
  );
  const otherFmsTemplates = navFmsTemplates.filter(
    (tpl) => !(tpl.triggerEvent === "PRODUCTION_STARTED" || usedFmsTemplateIds.has(tpl.templateId))
  );

  const items: NavEntry[] = [{ icon: "dashboard", href: "/dashboard", label: "Dashboard" }];

  // MDO — day-to-day work: everyone has tasks assigned to them and can be an FMS step's
  // assignee, and every person has at least their own tasks report.
  const mdoItems: NavItem[] = [
    { icon: "tasks", href: "/tasks", label: "Tasks" },
    { icon: "fms", href: "/fms", label: "Flow" },
    { icon: "leave", href: "/leave", label: "Leave" },
    { icon: "performance", href: "/reports", label: "Reports" },
  ];
  if (session.access.includes("PERFORMANCE_VIEW")) {
    mdoItems.push({ icon: "performance", href: "/performance", label: "Performance" });
  }
  items.push({ icon: "mdo", label: "MDO", items: mdoItems });

  // PMS — BOM, PPC, and every FMS Line a production plan actually starts.
  const pmsItems: NavItem[] = [];
  if (session.access.includes("BOM_MANAGE")) {
    pmsItems.push({ icon: "bom", href: "/bom", label: "BOM" });
  }
  if (session.access.includes("PPC_PLAN") || session.access.includes("INVENTORY_TXN")) {
    pmsItems.push({ icon: "ppc", href: "/ppc", label: "PPC" });
  }
  for (const tpl of pmsFmsTemplates) {
    pmsItems.push({ icon: "fms", href: `/fms/${tpl.templateId}`, label: tpl.templateName });
  }
  if (pmsItems.length > 0) {
    items.push({ icon: "pms", label: "PMS", items: pmsItems });
  }

  // Stock — Inventory (Raw Material/Consumable/Semi-FG) and Finished Goods, kept as two
  // separate boards so FG never sits mixed in with raw material stock.
  if (session.access.includes("INVENTORY_VIEW")) {
    items.push({
      icon: "stock",
      label: "Stock",
      items: [
        { icon: "inventory", href: "/inventory", label: "Inventory" },
        { icon: "inventory", href: "/inventory/fg", label: "Finished Goods" },
      ],
    });
  }

  // FMS — Inward (which already covers IQC as its own tab), plus every other named flow
  // (Purchase FMS, etc.) that isn't a PPC-connected Line.
  const fmsItems: NavItem[] = [];
  if (
    session.access.includes("INWARD_ENTRY") ||
    session.access.includes("IQC_CHECK") ||
    session.access.includes("IMS_VIEW")
  ) {
    fmsItems.push({ icon: "inward", href: "/inward", label: "Inward" });
  }
  if (session.access.includes("PURCHASE_FMS")) {
    fmsItems.push({ icon: "fms", href: "/purchase", label: "Purchase" });
  }
  if (session.access.includes("LEAD_FMS")) {
    fmsItems.push({ icon: "fms", href: "/leads", label: "Leads" });
  }
  if (session.access.includes("ORDER_FMS")) {
    fmsItems.push({ icon: "fms", href: "/orders", label: "Order" });
  }
  if (session.access.includes("PDI_FMS")) {
    fmsItems.push({ icon: "fms", href: "/pdi", label: "PDI" });
  }
  for (const tpl of otherFmsTemplates) {
    fmsItems.push({ icon: "fms", href: `/fms/${tpl.templateId}`, label: tpl.templateName });
  }
  if (fmsItems.length > 0) {
    items.push({ icon: "fms", label: "FMS", items: fmsItems });
  }

  // Others — master data and administration.
  const otherItems: NavItem[] = [];
  if (session.access.includes("PARTY_MASTER")) {
    otherItems.push({ icon: "parties", href: "/parties", label: "Vendors/Customers" });
  }
  if (session.role === "Admin") {
    otherItems.push({ icon: "users", href: "/admin/users", label: "Users" });
    otherItems.push({ icon: "settings", href: "/admin/settings", label: "Settings" });
  }
  // Platform operator only — not an organization Admin.
  if (isPlatformAdmin(session.email)) {
    otherItems.push({ icon: "platform", href: "/platform", label: "Platform" });
  }
  if (otherItems.length > 0) {
    items.push({ icon: "others", label: "Others", items: otherItems });
  }

  // Last, so it never pushes day-to-day work off a narrow screen.
  items.push({ icon: "guide", href: "/guide", label: "Guide" });

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2.5 rounded-md transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrgLogo url={logoUrl} name={org?.orgName ?? "Pro ERP"} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">Pro ERP</span>
              {org && (
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {org.orgName}
                </span>
              )}
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <span className="block text-sm font-medium leading-tight">
                {session.fullName}
              </span>
              <span className="block text-xs leading-tight text-muted-foreground">
                {session.email}
              </span>
            </div>
            <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
              {session.role}
            </Badge>
            {/* What's new is reachable by everyone too, same reasoning as Settings below —
                a doer with no Admin access still deserves to know what shipped. */}
            <ChangelogMenu />
            {/* Theme and language belong to the person, so they sit with their name —
                reachable by everyone, not only by an Admin who can open Settings. */}
            <SettingsMenu />
            <LogoutButton />
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl border-t px-4 sm:px-6">
          <NavLinks items={items} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
