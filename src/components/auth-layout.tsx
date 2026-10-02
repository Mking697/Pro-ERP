import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarOff,
  Handshake,
  Lock,
  MapPin,
  Package,
  ShieldCheck,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Translator } from "@/lib/i18n";

interface AuthFeature {
  icon: LucideIcon;
  title: string;
  description: string;
  /** One of the fixed chart-status tokens (globals.css) — each feature gets its own
   * identity color instead of every tile reusing one primary tint, the same reasoning
   * as the dashboard StatCard's own per-metric accent. */
  accent: "good" | "warning" | "critical" | "primary" | "series1" | "series2";
}

const ACCENT_VAR: Record<AuthFeature["accent"], string> = {
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  critical: "var(--chart-critical)",
  primary: "var(--primary)",
  series1: "var(--chart-series-1)",
  series2: "var(--chart-series-2)",
};

const FEATURES: AuthFeature[] = [
  {
    icon: Truck,
    title: "Sales se Dispatch tak",
    description: "Lead, Order, PDI, Transport aur Dispatch — poora safar track hota hai.",
    accent: "series1",
  },
  {
    icon: Handshake,
    title: "Purchase & Vendors",
    description: "Indent se PO tak, material aane tak — sab ek jagah.",
    accent: "series2",
  },
  {
    icon: Package,
    title: "Live Inventory",
    description: "Stock, BOM aur Production hamesha real-time sync mein rehte hain.",
    accent: "good",
  },
  {
    icon: Wallet,
    title: "Accounts & Ledger",
    description: "Real double-entry books — Invoices, Payments, GST sab track hota hai.",
    accent: "warning",
  },
  {
    icon: CalendarOff,
    title: "Payroll & Leave",
    description: "Salary runs aur buddy-system leave approval, ek hi system se.",
    accent: "critical",
  },
  {
    icon: BarChart3,
    title: "Real-time MIS",
    description: "Har team member ka score, seedha dashboard par dikhta hai.",
    accent: "primary",
  },
];

interface TrustBadge {
  icon: LucideIcon;
  label: string;
}

const TRUST_BADGES: TrustBadge[] = [
  { icon: ShieldCheck, label: "Bank jaisi Security" },
  { icon: Lock, label: "Aapka Data, Sirf Aapka" },
  { icon: MapPin, label: "Bharat ke Business ke liye" },
];

const STEPS: string[] = ["Setup Karein", "Team Add Karein", "Kaam Shuru Karein"];

/**
 * Shared shell for /login and /signup — a hero panel (branding, tagline, trust badges, a
 * 3-step "how it works", and a feature grid) next to the page's own form Card. Kept a plain
 * component (no hooks) so it renders equally well from the client Login page and the
 * server-rendered Signup page; each page passes its own already-resolved `t` rather than
 * this component picking a translation strategy itself.
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
        className="relative hidden overflow-hidden bg-muted/30 lg:flex lg:w-[48%] lg:flex-col lg:justify-between lg:gap-8 lg:p-8 xl:p-12"
        style={{
          backgroundImage: [
            "radial-gradient(circle at 15% 10%, color-mix(in oklch, var(--chart-series-1), transparent 82%), transparent 45%)",
            "radial-gradient(circle at 85% 85%, color-mix(in oklch, var(--primary), transparent 85%), transparent 50%)",
            "linear-gradient(135deg, color-mix(in oklch, var(--primary), transparent 88%), transparent 55%)",
            "radial-gradient(color-mix(in oklch, var(--primary), transparent 80%) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "auto, auto, auto, 22px 22px",
        }}
      >
        <div className="relative z-10 space-y-5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground shadow-sm shadow-primary/20">
              P
            </div>
            <div>
              <span className="block text-lg leading-tight font-semibold text-foreground">Pro ERP</span>
              <span className="block text-xs leading-tight text-muted-foreground">by Essor Automations</span>
            </div>
          </div>

          <p className="max-w-sm text-2xl leading-tight font-semibold text-foreground xl:text-3xl">
            {t("Apna poora business chalayein, ek hi system se.")}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {TRUST_BADGES.map((badge) => (
              <span key={badge.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <badge.icon className="size-3.5 text-primary" aria-hidden="true" />
                {t(badge.label)}
              </span>
            ))}
          </div>

          <div className="grid max-w-xs grid-cols-3 gap-2">
            {STEPS.map((step, i) => (
              <div key={step} className="flex flex-col items-center gap-1 text-center">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="text-[0.7rem] leading-tight text-muted-foreground">{t(step)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-4">
          {FEATURES.map((feature, i) => {
            const accentVar = ACCENT_VAR[feature.accent];
            return (
              <div
                key={feature.title}
                style={{ animationDelay: `${i * 60}ms` }}
                className="flex animate-in items-start gap-3 fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-500"
              >
                <div
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm"
                  style={{
                    background: `color-mix(in oklch, ${accentVar}, transparent 85%)`,
                    color: accentVar,
                  }}
                >
                  <feature.icon className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t(feature.title)}</p>
                  <p className="text-xs text-muted-foreground">{t(feature.description)}</p>
                </div>
              </div>
            );
          })}
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
