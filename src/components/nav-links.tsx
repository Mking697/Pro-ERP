"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Building2,
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
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const TRIGGER_CLASSES = cn(
  "relative flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
  "transition-colors duration-150",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "text-muted-foreground hover:bg-muted hover:text-foreground",
  "data-popup-open:bg-muted data-popup-open:text-foreground"
);

function ActiveUnderline() {
  return (
    // Position, not colour alone, marks the current section.
    <span
      aria-hidden="true"
      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground"
    />
  );
}

export default function NavLinks({ items }: { items: NavEntry[] }) {
  const pathname = usePathname();

  return (
    // Horizontal scroll rather than wrapping keeps the bar one row tall on narrow screens.
    <nav
      aria-label="Main"
      className="-mb-px flex items-center gap-1 overflow-x-auto"
    >
      {items.map((entry) => {
        if (isGroup(entry)) {
          const GroupIcon = entry.icon ? ICONS[entry.icon] : null;
          const groupActive = entry.items.some((child) => isActive(pathname, child.href));

          return (
            <DropdownMenu key={entry.label}>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(TRIGGER_CLASSES, groupActive && "text-foreground")}
                  >
                    {GroupIcon && <GroupIcon aria-hidden="true" className="size-4" />}
                    {entry.label}
                    {groupActive && <ActiveUnderline />}
                  </button>
                }
              />
              <DropdownMenuContent align="start" className="min-w-48">
                {entry.items.map((child) => {
                  const ChildIcon = child.icon ? ICONS[child.icon] : null;
                  const active = isActive(pathname, child.href);
                  return (
                    <DropdownMenuItem
                      key={child.href}
                      render={
                        <Link
                          href={child.href}
                          aria-current={active ? "page" : undefined}
                          className={active ? "bg-accent text-accent-foreground" : undefined}
                        >
                          {ChildIcon && <ChildIcon aria-hidden="true" className="size-4" />}
                          {child.label}
                        </Link>
                      }
                    />
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }

        const active = isActive(pathname, entry.href);
        const Icon = entry.icon ? ICONS[entry.icon] : null;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(TRIGGER_CLASSES, active && "text-foreground")}
          >
            {Icon && <Icon aria-hidden="true" className="size-4" />}
            {entry.label}
            {active && <ActiveUnderline />}
          </Link>
        );
      })}
    </nav>
  );
}
