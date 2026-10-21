"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import { formatDueDisplay } from "@/lib/formatDate";
import { cn } from "@/lib/utils";
import { PLAN_LIMITS, type BillingCycle, type PlanTier } from "@/lib/platform/planLimits";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

interface BillingStatus {
  plan: string;
  billingCycle: string;
  trialEndsAt: string | null;
  planRenewsAt: string | null;
  maxActiveUsers: number | null;
  maxCompanies: number | null;
  activeUserCount: number;
  subscriptionStatus: string;
}

const PAID_TIERS: PlanTier[] = ["Starter", "Growth", "Enterprise"];

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Days left on the trial countdown, or null once it's on a real plan. Extracted to a
 * plain function (not an inline Date.now() call in render) — matches the established
 * react-hooks/purity-safe pattern already used by plan-status-card.tsx. */
function trialDaysLeft(status: BillingStatus | null): number | null {
  if (status?.plan !== "Trial" || !status.trialEndsAt) return null;
  return Math.ceil((new Date(status.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export default function BillingClient() {
  const t = useT();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<BillingCycle>("Monthly");
  const [payingPlan, setPayingPlan] = useState<PlanTier | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Named so handleBuy() can reuse it after a successful payment; the initial mount load
  // below calls the equivalent fetch chain inline (not through this reference) because
  // this project's react-hooks/set-state-in-effect lint rule flags an effect body calling
  // a named function that itself sets state — matches plan-status-card.tsx's own
  // established pattern for exactly this reason.
  function loadStatus() {
    setLoading(true);
    fetch("/api/billing/status")
      .then((res) => {
        if (!res.ok) throw new Error("status fetch failed");
        return res.json();
      })
      .then((data: BillingStatus) => setStatus(data))
      .catch(() => toast.error(t("Plan details load nahi ho paye.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetch("/api/billing/status")
      .then((res) => {
        if (!res.ok) throw new Error("status fetch failed");
        return res.json();
      })
      .then((data: BillingStatus) => setStatus(data))
      .catch(() => toast.error(t("Plan details load nahi ho paye.")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable from context, same as plan-status-card.tsx's own effect.
  }, []);

  const daysLeft = trialDaysLeft(status);

  async function handleBuy(plan: PlanTier) {
    if (!scriptReady || !window.Razorpay) {
      toast.error(t("Payment gateway abhi load ho raha hai, thodi der mein dobara try karein."));
      return;
    }
    setPayingPlan(plan);
    try {
      const subRes = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, cycle }),
      });
      const subData = await subRes.json();
      if (!subRes.ok) {
        toast.error(subData.error ?? t("Subscription nahi ban paayi."));
        setPayingPlan(null);
        return;
      }

      const razorpay = new window.Razorpay({
        key: subData.razorpayKeyId,
        subscription_id: subData.subscriptionId,
        name: "Pro ERP",
        description: `${plan} — ${cycle} (${t("auto-renew")})`,
        // The plan change itself is applied server-side only once Razorpay's own
        // subscription.activated/charged webhook confirms the authorization payment went
        // through — this handler never flips the plan itself, it just lets the Admin know
        // what to expect while that webhook is in flight (usually a few seconds).
        handler: () => {
          toast.success(
            t("Payment ho gaya! Subscription activate hone mein thodi der lag sakti hai.")
          );
          setTimeout(loadStatus, 3000);
          setPayingPlan(null);
        },
        modal: {
          ondismiss: () => setPayingPlan(null),
        },
        theme: { color: "#000000" },
      });
      razorpay.open();
    } catch {
      toast.error(t("Kuch galat ho gaya. Dobara try karein."));
      setPayingPlan(null);
    }
  }

  const subscriptionIsLive =
    status?.subscriptionStatus === "active" ||
    status?.subscriptionStatus === "authenticated" ||
    status?.subscriptionStatus === "created";

  async function handleCancelSubscription() {
    setCancelling(true);
    try {
      const res = await fetch("/api/billing/cancel-subscription", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("Subscription cancel nahi ho paayi."));
        return;
      }
      toast.success(
        t("Subscription cancel ho gayi — current cycle khatm hone tak access chalta rahega.")
      );
      loadStatus();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        onLoad={() => setScriptReady(true)}
        strategy="lazyOnload"
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("Current Plan")}</CardTitle>
          <CardDescription>{t("Aapke organization ka current plan aur status.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading || !status ? (
            <FormSkeleton fields={1} label={t("Plan load ho raha hai")} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={daysLeft !== null && daysLeft <= 0 ? "destructive" : "default"}>
                  {status.plan}
                </Badge>
                {status.billingCycle && (
                  <span className="text-sm text-muted-foreground">({status.billingCycle})</span>
                )}
                {daysLeft !== null && (
                  <span className={daysLeft <= 0 ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                    {daysLeft > 0 ? `${daysLeft} ${t("din baaki")}` : t("Trial khatm ho gaya")}
                  </span>
                )}
                {status.planRenewsAt && (
                  <span className="text-sm text-muted-foreground">
                    {t("Agla renewal")}: {formatDueDisplay(status.planRenewsAt)}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("Active users")}: {status.activeUserCount}
                {status.maxActiveUsers !== null && ` / ${status.maxActiveUsers}`}
                {status.maxCompanies !== null &&
                  ` ${t("· Companies: up to")} ${status.maxCompanies}`}
              </p>
              {subscriptionIsLive && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelling}
                  onClick={handleCancelSubscription}
                >
                  {cancelling ? t("Cancel ho raha hai...") : t("Subscription cancel karein")}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={cycle === "Monthly" ? "default" : "outline"}
          onClick={() => setCycle("Monthly")}
        >
          {t("Monthly")}
        </Button>
        <Button
          size="sm"
          variant={cycle === "Yearly" ? "default" : "outline"}
          onClick={() => setCycle("Yearly")}
        >
          {t("Yearly")} <span className="ml-1 text-xs opacity-80">({t("~2 months free")})</span>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PAID_TIERS.map((plan) => {
          const limit = PLAN_LIMITS[plan];
          const pricePaise = cycle === "Yearly" ? limit.yearlyPricePaise : limit.monthlyPricePaise;
          const isCurrent = status?.plan === plan;
          return (
            <Card key={plan} className={cn(isCurrent && "ring-2 ring-primary")}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {plan}
                  {isCurrent && <Badge>{t("Current")}</Badge>}
                </CardTitle>
                <CardDescription>
                  {pricePaise !== null && (
                    <>
                      <span className="text-xl font-semibold text-foreground">
                        {formatRupees(pricePaise)}
                      </span>{" "}
                      / {cycle === "Yearly" ? t("year") : t("month")}
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>
                    {limit.maxActiveUsers !== null
                      ? `${limit.maxActiveUsers} ${t("active users tak")}`
                      : t("Unlimited users")}
                  </li>
                  <li>
                    {limit.maxCompanies !== null
                      ? `${limit.maxCompanies} ${t("company tak")}`
                      : t("Unlimited companies")}
                  </li>
                  <li>{t("Saare modules")}</li>
                </ul>
                <Button
                  className="w-full"
                  disabled={isCurrent || payingPlan !== null || !scriptReady}
                  onClick={() => handleBuy(plan)}
                >
                  {isCurrent
                    ? t("Current Plan")
                    : payingPlan === plan
                      ? t("Processing...")
                      : t("Upgrade karein")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
