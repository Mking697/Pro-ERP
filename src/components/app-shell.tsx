import Link from "next/link";
import { getOrganization } from "@/lib/platform/registry";
import type { SessionPayload } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import NavLinks, { type NavItem } from "@/components/nav-links";
import LogoutButton from "@/app/dashboard/logout-button";
import { isPlatformAdmin } from "@/lib/platform/admin";

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

  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard" }];

  // Everyone has tasks assigned to them, so Tasks is always reachable.
  items.push({ href: "/tasks", label: "Tasks" });

  if (
    session.access.includes("INWARD_ENTRY") ||
    session.access.includes("IQC_CHECK") ||
    session.access.includes("IMS_VIEW")
  ) {
    items.push({ href: "/inward", label: "Inward" });
  }

  if (session.access.includes("PERFORMANCE_VIEW")) {
    items.push({ href: "/performance", label: "Performance" });
  }

  if (session.role === "Admin") {
    items.push({ href: "/admin/users", label: "Users" });
    items.push({ href: "/admin/settings", label: "Settings" });
  }

  // Platform operator only — not an organization Admin.
  if (isPlatformAdmin(session.email)) {
    items.push({ href: "/platform", label: "Platform" });
  }

  // Last, so it never pushes day-to-day work off a narrow screen.
  items.push({ href: "/guide", label: "Guide" });

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-xs font-bold text-background"
            >
              PE
            </span>
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
