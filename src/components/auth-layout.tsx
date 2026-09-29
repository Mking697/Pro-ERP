import type { ReactNode } from "react";
import { BarChart3, Building2, Package, Workflow, type LucideIcon } from "lucide-react";
import type { Translator } from "@/lib/i18n";

interface AuthFeature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const FEATURES: AuthFeature[] = [
  {
    icon: Workflow,
    title: "FMS Automation",
    description: "Purchase se Dispatch tak, har flow khud-ba-khud aage badhta hai.",
  },
  {
    icon: Package,
    title: "Live Inventory",
    description: "Stock, BOM aur Production hamesha real-time sync mein rehte hain.",
  },
  {
    icon: BarChart3,
    title: "Real-time MIS",
    description: "Har team member ka score, seedha dashboard par dikhta hai.",
  },
  {
    icon: Building2,
    title: "Multi-tenant Suraksha",
    description: "Ek hi system, har organization ka data alag aur surakshit rehta hai.",
  },
];

/**
 * Shared shell for /login and /signup — a hero panel (branding + feature highlights) next
 * to the page's own form Card. Kept a plain component (no hooks) so it renders equally well
 * from the client Login page and the server-rendered Signup page; each page passes its own
 * already-resolved `t` rather than this component picking a translation strategy itself.
 */
export default function AuthLayout({
  t,
  children,
}: {
  t: Translator;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div
        className="relative hidden overflow-hidden bg-muted/30 lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:p-12 xl:p-16"
        style={{
          backgroundImage: [
            "linear-gradient(135deg, color-mix(in oklch, var(--primary), transparent 85%), transparent 55%)",
            "radial-gradient(color-mix(in oklch, var(--primary), transparent 78%) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "auto, 22px 22px",
        }}
      >
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground shadow-sm shadow-primary/20">
            P
          </div>
          <span className="text-lg font-semibold text-foreground">Pro ERP</span>
        </div>

        <p className="relative z-10 max-w-sm text-3xl leading-tight font-semibold text-foreground">
          {t("Apna poora business chalayein, ek hi system se.")}
        </p>

        <div className="relative z-10 space-y-6">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-5" />
              </div>
              <div>
                <p className="font-medium text-foreground">{t(feature.title)}</p>
                <p className="text-sm text-muted-foreground">{t(feature.description)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 border-b p-4 lg:hidden">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          P
        </div>
        <span className="font-semibold text-foreground">Pro ERP</span>
      </div>

      <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
        {children}
      </div>
    </div>
  );
}
