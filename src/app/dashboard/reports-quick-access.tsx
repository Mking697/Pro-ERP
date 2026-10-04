import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Banknote,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Factory,
  Gauge,
  Layers,
  ListTodo,
  PackageCheck,
  PackageSearch,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Warehouse,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ReportDefinition } from "@/lib/reports";
import type { Translator } from "@/lib/i18n";

/**
 * Which icon represents each report. Kept here instead of on ReportDefinition because
 * `lib/reports.ts` is deliberately free of non-trivial imports (a client component reads
 * it too) — icons are a presentation concern, not part of the report's identity.
 */
const REPORT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tasks: ListTodo,
  delegation: Users,
  recurring: CalendarClock,
  inward: PackageSearch,
  iqc: ShieldCheck,
  ims: Boxes,
  inventory: Warehouse,
  indents: ClipboardList,
  bom: Layers,
  ppc: Factory,
  performance: Gauge,
  leave: CalendarClock,
  "finished-goods": PackageCheck,
  leads: UserPlus,
  orders: ShoppingCart,
  pdi: ClipboardCheck,
  tms: Truck,
  accounts: Wallet,
  dispatch: Truck,
  payroll: Banknote,
  maintenance: Wrench,
};

/**
 * Home-page entry point into the reports — the same cards that used to live only behind
 * the "Reports" tab, surfaced directly on Overview so a report is one click from login
 * instead of two. Each card links straight to `/reports/[id]`; nothing here is clickable
 * beyond that link, matching how the analytics tab cards already behave.
 */
export default function ReportsQuickAccess({
  reports,
  t,
}: {
  reports: ReportDefinition[];
  t: Translator;
}) {
  if (reports.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map((report, i) => {
        const Icon = REPORT_ICONS[report.id] ?? ListTodo;
        return (
          <Card
            key={report.id}
            size="sm"
            style={{ animationDelay: `${i * 60}ms` }}
            className="group/report relative animate-in overflow-hidden fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-500"
          >
            <Link
              href={`/reports/${report.id}`}
              className="flex items-start gap-3 px-4 py-3.5 after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform duration-200 group-hover/report:scale-110 [&_svg]:size-4.5"
              >
                <Icon className="size-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(report.label)}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {t(report.description)}
                </p>
              </div>
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover/report:-translate-y-0.5 group-hover/report:translate-x-0.5 group-hover/report:text-primary"
              />
            </Link>
          </Card>
        );
      })}
    </div>
  );
}
