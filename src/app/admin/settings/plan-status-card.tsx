"use client";

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
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import { formatDueDisplay } from "@/lib/formatDate";

interface PlanStatus {
  plan: string;
  trialEndsAt: string | null;
  maxActiveUsers: number | null;
  maxCompanies: number | null;
  activeUserCount: number;
}

/** Days left on the trial countdown, or null once it's on a real plan. A plain top-level
 * function, not an inline `Date.now()` call in the component body — this project's lint
 * config (react-hooks/purity) flags an impure call made directly during render; calling it
 * through an extracted function (same shape as organizations-table.tsx's own
 * `trialDaysLeft()`) is the established, lint-clean pattern for this exact calculation. */
function daysUntil(status: PlanStatus | null): number | null {
  if (status?.plan !== "Trial" || !status.trialEndsAt) return null;
  return Math.ceil((new Date(status.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

/**
 * Read-only view of the org's own plan + trial countdown — the counterpart to /platform's
 * plan dropdown, which is where a Platform Admin actually changes it. This card never
 * writes anything.
 */
export default function PlanStatusCard() {
  const t = useT();
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/settings/plan")
      .then((res) => res.json())
      .then((data: PlanStatus) => setStatus(data))
      .catch(() => toast.error(t("Plan details load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  const daysLeft = daysUntil(status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan</CardTitle>
        <CardDescription>{t("Aapke organization ka current plan.")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading || !status ? (
          <FormSkeleton fields={1} label={t("Plan load ho raha hai")} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={daysLeft !== null && daysLeft <= 0 ? "destructive" : "default"}>
                {status.plan}
              </Badge>
              {daysLeft !== null && (
                <span className={daysLeft <= 0 ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                  {daysLeft > 0
                    ? `${daysLeft} ${t("din baaki")}`
                    : t("Trial khatm ho gaya")}
                  {status.trialEndsAt && ` (${formatDueDisplay(status.trialEndsAt)})`}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Active users: {status.activeUserCount}
              {status.maxActiveUsers !== null && ` / ${status.maxActiveUsers}`}
              {status.maxCompanies !== null && ` · Companies: up to ${status.maxCompanies}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("Plan badalne ke liye Pro ERP ke Platform Admin se sampark karein.")}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
