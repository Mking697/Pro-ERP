import Link from "next/link";
import {
  Boxes,
  ClipboardList,
  Factory,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserPlus,
  Wallet,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Translator } from "@/lib/i18n";

interface WorkCenter {
  key: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** Which of the fixed chart-status tokens tints this tile's icon. */
  accent: "primary" | "good" | "warning" | "critical";
  /** Any one of these grants is enough to show this tile — mirrors reports-quick-access's
   * own OR semantics, since more than one module grant can lead into the same place. */
  grants: readonly string[];
}

const WORK_CENTERS: readonly WorkCenter[] = [
  { key: "leads", label: "Sales", description: "Enquiries & Orders", href: "/leads", icon: UserPlus, accent: "primary", grants: ["LEAD_FMS"] },
  { key: "purchase", label: "Purchase", description: "Materials & Suppliers", href: "/purchase", icon: ShoppingCart, accent: "good", grants: ["PURCHASE_FMS"] },
  { key: "inventory", label: "Inventory", description: "Stock & Shortages", href: "/inventory", icon: Warehouse, accent: "primary", grants: ["INVENTORY_VIEW"] },
  { key: "ppc", label: "Production", description: "Plans & Scheduling", href: "/ppc", icon: Factory, accent: "primary", grants: ["PPC_PLAN", "INVENTORY_TXN"] },
  { key: "inward", label: "Quality", description: "Inspection & Testing", href: "/inward", icon: ShieldCheck, accent: "critical", grants: ["IQC_CHECK", "IMS_VIEW", "INWARD_ENTRY"] },
  { key: "orders", label: "Orders", description: "Sales Orders", href: "/orders", icon: ClipboardList, accent: "primary", grants: ["ORDER_FMS"] },
  { key: "accounts", label: "Accounts", description: "Receivables & Payables", href: "/accounts", icon: Wallet, accent: "warning", grants: ["ACCOUNTS_FMS"] },
  { key: "dispatch", label: "Dispatch", description: "Shipments & Delivery", href: "/dispatch", icon: Truck, accent: "good", grants: ["DISPATCH_FMS"] },
  { key: "bom", label: "BOM", description: "Bill of Materials", href: "/bom", icon: Boxes, accent: "primary", grants: ["BOM_MANAGE"] },
  { key: "maintenance", label: "Maintenance", description: "Machines & Equipment", href: "/maintenance", icon: Wrench, accent: "warning", grants: ["MAINTENANCE_FMS"] },
] as const;

function accentVarFor(accent: WorkCenter["accent"]): string {
  if (accent === "good") return "var(--chart-good)";
  if (accent === "warning") return "var(--chart-warning)";
  if (accent === "critical") return "var(--chart-critical)";
  return "var(--primary)";
}

/**
 * The home-page work-center strip — one tile per module this viewer can actually open,
 * linking straight to that module's own page (not its report). Mirrors the colored
 * icon-button row from the reference dashboard mock, but built from MODULE_ACCESS grants
 * instead of a fixed list, so it never offers a tile that would just bounce the viewer.
 */
export default function ModuleQuickNav({
  access,
  t,
}: {
  access: readonly string[];
  t: Translator;
}) {
  const visible = WORK_CENTERS.filter((wc) => wc.grants.some((g) => access.includes(g)));
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {visible.map((wc, i) => {
        const Icon = wc.icon;
        const accentVar = accentVarFor(wc.accent);
        return (
          <Card
            key={wc.key}
            size="sm"
            style={{ animationDelay: `${i * 40}ms` }}
            className="group/wc relative animate-in overflow-hidden fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-500"
          >
            <Link
              href={wc.href}
              className="flex items-center gap-2.5 px-3 py-2.5 after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--accent-icon)] transition-transform duration-200 group-hover/wc:scale-110 [&_svg]:size-4"
                style={{
                  background: `color-mix(in oklch, ${accentVar}, transparent 85%)`,
                  ["--accent-icon" as string]: accentVar,
                }}
              >
                <Icon className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t(wc.label)}</p>
                <p className="truncate text-[11px] text-muted-foreground">{t(wc.description)}</p>
              </div>
            </Link>
          </Card>
        );
      })}
    </div>
  );
}
