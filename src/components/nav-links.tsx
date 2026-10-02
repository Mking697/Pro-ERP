"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarOff,
  ChevronDown,
  ClipboardList,
  Factory,
  Handshake,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  Package,
  Settings,
  Truck,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Icons live here, keyed by name, because the nav is assembled in a server component and
 * a component cannot be handed across that boundary as a plain prop.
 *
 * Every item keeps its text label — an icon alone would make people guess, and this bar
 * carries items ("BOM", "PPC") whose icons nobody recognises on sight.
 */
const ICONS = {
  dashboard: LayoutDashboard,
  tasks: ListChecks,
  inventory: Package,
  bom: ClipboardList,
  ppc: Factory,
  inward: Truck,
  fms: Workflow,
  parties: Handshake,
  performance: BarChart3,
  users: Users,
  settings: Settings,
  platform: Building2,
  guide: BookOpen,
  mdo: LayoutGrid,
  pms: Factory,
  stock: Package,
  others: MoreHorizontal,
  leave: CalendarOff,
  payroll: Wallet,
  chatbot: Bot,
} as const;

export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon?: NavIcon;
}

export interface NavGroup {
  label: string;
  icon?: NavIcon;
  items: NavItem[];
}

/** A group is any entry carrying its own `items` — a plain link never does. */
export type NavEntry = NavItem | NavGroup;

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

/**
 * Highlights the section the user is currently in.
 *
 * Matching is prefix-based so a nested route (/admin/users) still marks its section
 * active, with "/" handled exactly so it does not match everything.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ROW_CLASSES = cn(
  "group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium",
  "transition-all duration-150 not-disabled:active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "text-muted-foreground hover:bg-muted hover:text-foreground"
);

/** Active-item accent bar — a short rounded rule at the inline-start edge, the same
 * pattern a group-active row already used, now shared by every leaf link too so the
 * "where am I" signal is consistent everywhere in the nav, not just on group headers. */
const ACTIVE_BAR = (
  <span
    aria-hidden="true"
    className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
  />
);

/**
 * The sidebar's nav body — rendered once inside the persistent desktop `<aside>` and once
 * inside the mobile drawer (two mounts, not one JS-toggled tree), since the two contexts
 * disagree on whether `collapsed` can ever be true. Both read the same `items`.
 *
 * Groups render as always-visible collapsible sections rather than popovers. That is a
 * deliberate simplification, not an oversight: a popover-based group menu is what used to
 * need a `collisionBoundary` fix (see git history on the old dropdown-bar nav) to avoid
 * rendering off-screen inside a scrolled ancestor — a section that is always part of the
 * page's own flow has no collision geometry to get wrong in the first place.
 */
export default function NavLinks({
  items,
  collapsed = false,
  onNavigate,
}: {
  items: NavEntry[];
  /** Icon-rail mode (desktop only) — never true inside the mobile drawer. */
  collapsed?: boolean;
  /** Called after a link is clicked — the mobile drawer uses this to close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  function isGroupOpen(entry: NavGroup): boolean {
    const explicit = openGroups[entry.label];
    if (explicit !== undefined) return explicit;
    // Default open state: whichever group holds the current route.
    return entry.items.some((child) => isActive(pathname, child.href));
  }

  function toggleGroup(label: string, currentlyOpen: boolean) {
    setOpenGroups((prev) => ({ ...prev, [label]: !currentlyOpen }));
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((entry) => {
        if (isGroup(entry)) {
          const GroupIcon = entry.icon ? ICONS[entry.icon] : null;
          const groupActive = entry.items.some((child) => isActive(pathname, child.href));
          const open = isGroupOpen(entry);
          const panelId = `nav-group-${entry.label.replace(/\s+/g, "-").toLowerCase()}`;

          // Collapsed rail: a group can't show its children with no room for labels, so
          // its own icon is just a link-like affordance that snaps the sidebar back open
          // (handled by the parent via onNavigate-style callback would be overreach here —
          // simplest correct behaviour is: clicking it also opens the group, and the
          // parent shell separately decides collapsed width from its own persisted state,
          // so this button only ever needs to flip `open`).
          return (
            <div key={entry.label}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.label, open)}
                aria-expanded={open}
                aria-controls={panelId}
                title={collapsed ? entry.label : undefined}
                className={cn(ROW_CLASSES, groupActive && "font-semibold text-foreground", collapsed && "justify-center px-0")}
              >
                {GroupIcon && (
                  <GroupIcon
                    aria-hidden="true"
                    className={cn("size-4 shrink-0", groupActive && "text-primary")}
                  />
                )}
                {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{entry.label}</span>}
                {!collapsed && (
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("size-4 shrink-0 text-muted-foreground/70 transition-transform duration-150", open && "rotate-180")}
                  />
                )}
                {groupActive && ACTIVE_BAR}
              </button>
              {!collapsed && open && (
                <div id={panelId} className="mt-0.5 ml-4 flex flex-col gap-0.5 border-l pl-3 py-0.5">
                  {entry.items.map((child) => {
                    const ChildIcon = child.icon ? ICONS[child.icon] : null;
                    const active = isActive(pathname, child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                        className={cn(
                          ROW_CLASSES,
                          "py-1.5",
                          active &&
                            "bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary"
                        )}
                      >
                        {ChildIcon && <ChildIcon aria-hidden="true" className="size-4 shrink-0" />}
                        <span className="min-w-0 truncate">{child.label}</span>
                        {active && ACTIVE_BAR}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        const active = isActive(pathname, entry.href);
        const Icon = entry.icon ? ICONS[entry.icon] : null;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            title={collapsed ? entry.label : undefined}
            className={cn(
              ROW_CLASSES,
              active && "bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary",
              collapsed && "justify-center px-0"
            )}
          >
            {Icon && <Icon aria-hidden="true" className="size-4 shrink-0" />}
            {!collapsed && <span className="min-w-0 truncate">{entry.label}</span>}
            {active && ACTIVE_BAR}
          </Link>
        );
      })}
    </nav>
  );
}
