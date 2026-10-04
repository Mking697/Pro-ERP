import Link from "next/link";
import {
  AlertTriangle,
  FileText,
  ShieldAlert,
  Truck,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Translator } from "@/lib/i18n";
import { listInwardEntries } from "@/lib/inward";
import { listLeads } from "@/lib/leads/leads";
import { listAllQuotations } from "@/lib/leads/quotations";
import { listDispatches } from "@/lib/dispatch/dispatch";
import { getReceivablesAging } from "@/lib/accounts/accounts";
import { listMaintenanceRequests } from "@/lib/maintenance/maintenance";

/** `₹1.2L` / `₹47K` style — the aging totals here are whole rupees, and this stays local
 * since no shared currency formatter exists elsewhere in the app (every other call site
 * just interpolates `₹${amount}` directly). */
function formatINR(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${Math.round(amount)}`;
}

interface Tile {
  key: string;
  label: string;
  value: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  accent: "primary" | "good" | "warning" | "critical";
}

/** A read that must never take the whole strip down — one module's broken sheet/query
 * should drop only its own tile, same pattern as analytics.tsx's `safe()`. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function accentVarFor(accent: Tile["accent"]): string {
  if (accent === "good") return "var(--chart-good)";
  if (accent === "warning") return "var(--chart-warning)";
  if (accent === "critical") return "var(--chart-critical)";
  return "var(--primary)";
}

/**
 * The home-page "what needs attention right now" strip — a row of small live counts,
 * each one only computed (and only shown) when the viewer actually holds that module's
 * grant. Every number here is a live read, not a cached snapshot, so it agrees with
 * whatever the viewer sees after clicking through.
 */
export default async function AttentionStrip({
  access,
  t,
}: {
  access: readonly string[];
  t: Translator;
}) {
  const tiles: Tile[] = [];

  if (access.includes("IQC_CHECK") || access.includes("IMS_VIEW") || access.includes("INWARD_ENTRY")) {
    const inward = await safe(() => listInwardEntries());
    if (inward) {
      const pending = inward.filter((e) => e.IQC_Status !== "Verified").length;
      tiles.push({
        key: "iqc",
        label: t("Quality Issues"),
        value: String(pending),
        hint: t("IQC check pending"),
        href: "/inward",
        icon: ShieldAlert,
        accent: pending > 0 ? "critical" : "good",
      });
    }
  }

  if (access.includes("LEAD_FMS")) {
    const leads = await safe(() => listLeads());
    if (leads) {
      const open = leads.filter(
        (l) => !["Junk", "Order_Confirmed", "Lost"].includes(l.status)
      ).length;
      tiles.push({
        key: "leads",
        label: t("Open Enquiries"),
        value: String(open),
        hint: t("Follow-up chahiye"),
        href: "/leads",
        icon: UserPlus,
        accent: "primary",
      });
    }

    const quotations = await safe(() => listAllQuotations());
    if (quotations) {
      const pending = quotations.filter((q) => q.status === "Sent").length;
      tiles.push({
        key: "quotations",
        label: t("Quotations Pending"),
        value: String(pending),
        hint: t("Customer se jawab chahiye"),
        href: "/leads",
        icon: FileText,
        accent: pending > 0 ? "warning" : "good",
      });
    }
  }

  if (access.includes("DISPATCH_FMS")) {
    const dispatches = await safe(() => listDispatches("In_Transit"));
    if (dispatches) {
      tiles.push({
        key: "dispatch",
        label: t("In Transit"),
        value: String(dispatches.length),
        hint: t("Delivery ka intezaar"),
        href: "/dispatch",
        icon: Truck,
        accent: "primary",
      });
    }
  }

  if (access.includes("ACCOUNTS_FMS")) {
    const aging = await safe(() => getReceivablesAging());
    if (aging) {
      const overdue = aging.bucketTotals["61-90"] + aging.bucketTotals["90+"];
      tiles.push({
        key: "overdue",
        label: t("Payments Overdue"),
        value: formatINR(overdue),
        hint: t("60 din se upar"),
        href: "/accounts",
        icon: AlertTriangle,
        accent: overdue > 0 ? "critical" : "good",
      });
    }
  }

  if (access.includes("MAINTENANCE_FMS")) {
    const requests = await safe(() => listMaintenanceRequests());
    if (requests) {
      const openBreakdowns = requests.filter(
        (r) => r.kind === "Breakdown" && (r.status === "Open" || r.status === "Fixed_By_Maintenance")
      ).length;
      tiles.push({
        key: "maintenance",
        label: t("Line Breakdowns"),
        value: String(openBreakdowns),
        hint: t("Abhi pause hai"),
        href: "/maintenance",
        icon: Wrench,
        accent: openBreakdowns > 0 ? "critical" : "good",
      });
    }
  }

  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile, i) => {
        const Icon = tile.icon;
        const accentVar = accentVarFor(tile.accent);
        return (
          <Card
            key={tile.key}
            size="sm"
            style={{ animationDelay: `${i * 40}ms` }}
            className="group/tile relative animate-in overflow-hidden fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-500"
          >
            <Link
              href={tile.href}
              className="flex items-start gap-2.5 px-3 py-3 after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[color:var(--accent-icon)] [&_svg]:size-4"
                style={{
                  background: `color-mix(in oklch, ${accentVar}, transparent 85%)`,
                  ["--accent-icon" as string]: accentVar,
                }}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-muted-foreground">{tile.label}</p>
                <p className="text-lg font-semibold tabular-nums">{tile.value}</p>
                <p className="truncate text-[11px] text-muted-foreground">{tile.hint}</p>
              </div>
            </Link>
          </Card>
        );
      })}
    </div>
  );
}
