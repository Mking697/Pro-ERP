import Link from "next/link";
import { getOrganization } from "@/lib/platform/registry";
import type { SessionPayload } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import NavLinks, { type NavItem } from "@/components/nav-links";
import LogoutButton from "@/app/dashboard/logout-button";
import { isPlatformAdmin } from "@/lib/platform/admin";
import { getSetting } from "@/lib/settings";
import { OrgLogo } from "@/components/logo-picker";
import SettingsMenu from "@/components/settings-menu";
import { listNavFmsTemplates } from "@/lib/fms/templates";
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

  const items: NavItem[] = [{ icon: "dashboard", href: "/dashboard", label: "Dashboard" }];

  // Everyone has tasks assigned to them, so Tasks is always reachable.
  items.push({ icon: "tasks", href: "/tasks", label: "Tasks" });

  // Anyone can be the assignee of an FMS step, same tier as Tasks.
  items.push({ icon: "fms", href: "/fms", label: "FMS" });

  // Each designed flow gets its own named nav item alongside the generic FMS tabs, so a
  // doer working an "Inward FMS" or a "Purchase FMS" reaches its operational view
  // directly instead of hunting through every template mixed together.
  for (const tpl of navFmsTemplates) {
    items.push({ icon: "fms", href: `/fms/${tpl.templateId}`, label: tpl.templateName });
  }

  // Every person has at least their own tasks report.
  items.push({ icon: "performance", href: "/reports", label: "Reports" });

  if (session.access.includes("INVENTORY_VIEW")) {
    items.push({ icon: "inventory", href: "/inventory", label: "Inventory" });
  }

  if (session.access.includes("BOM_MANAGE")) {
    items.push({ icon: "bom", href: "/bom", label: "BOM" });
  }

  // Production-floor users reach PPC to start a run, planners to build one.
  if (
    session.access.includes("PPC_PLAN") ||
    session.access.includes("INVENTORY_TXN")
  ) {
    items.push({ icon: "ppc", href: "/ppc", label: "PPC" });
  }

  if (
    session.access.includes("INWARD_ENTRY") ||
    session.access.includes("IQC_CHECK") ||
    session.access.includes("IMS_VIEW")
  ) {
    items.push({ icon: "inward", href: "/inward", label: "Inward" });
  }

  if (session.access.includes("PARTY_MASTER")) {
    items.push({ icon: "parties", href: "/parties", label: "Vendors/Customers" });
  }

  if (session.access.includes("PERFORMANCE_VIEW")) {
    items.push({ icon: "performance", href: "/performance", label: "Performance" });
  }

  if (session.role === "Admin") {
    items.push({ icon: "users", href: "/admin/users", label: "Users" });
    items.push({ icon: "settings", href: "/admin/settings", label: "Settings" });
  }

  // Platform operator only — not an organization Admin.
  if (isPlatformAdmin(session.email)) {
    items.push({ icon: "platform", href: "/platform", label: "Platform" });
  }

  // Last, so it never pushes day-to-day work off a narrow screen.
  items.push({ icon: "guide", href: "/guide", label: "Guide" });

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrgLogo url={logoUrl} name={org?.Org_Name ?? "Pro ERP"} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">Pro ERP</span>
              {org && (
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {org.Org_Name}
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
