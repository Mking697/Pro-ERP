"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Building2,
  ClipboardList,
  Factory,
  LayoutDashboard,
  ListChecks,
  Package,
  Settings,
  Truck,
  Users,
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
  performance: BarChart3,
  users: Users,
  settings: Settings,
  platform: Building2,
  guide: BookOpen,
} as const;

export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon?: NavIcon;
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

export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    // Horizontal scroll rather than wrapping keeps the bar one row tall on narrow screens.
    <nav
      aria-label="Main"
      className="-mb-px flex items-center gap-1 overflow-x-auto"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon ? ICONS[item.icon] : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {Icon && <Icon aria-hidden="true" className="size-4" />}
            {item.label}
            {active && (
              // Position, not colour alone, marks the current section.
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
