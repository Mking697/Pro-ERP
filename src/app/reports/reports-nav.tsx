"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The persistent list of every report the viewer can see, alongside whichever one is
 * currently open. A client component so it can read the current path and highlight the
 * active report — a plain Server Component has no access to that.
 *
 * Horizontal scrollable pills on a narrow screen, a vertical sidebar list from `lg` up —
 * a full vertical list on mobile would push the actual report several screens down before
 * a reader ever sees it.
 */
export default function ReportsNav({
  reports,
}: {
  reports: { id: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Reports"
      className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
    >
      {reports.map((report) => {
        const href = `/reports/${report.id}`;
        const active = pathname === href;
        return (
          <Link
            key={report.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors lg:whitespace-normal",
              active
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {report.label}
          </Link>
        );
      })}
    </nav>
  );
}
