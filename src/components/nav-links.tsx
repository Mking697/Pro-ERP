"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
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
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 rounded-md px-3 py-2 text-sm font-medium",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
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
