"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDueDisplay } from "@/lib/formatDate";
import { parseStamp } from "@/lib/timestamp";
import { useT } from "@/components/preferences-provider";
import type { FmsRunRecord } from "@/app/fms/types";
import CompleteStepDialog from "@/app/fms/complete-step-dialog";

/** Mirrors isFmsStepOverdue() in src/lib/fms/engine.ts — a live label, never stored. */
function isOverdue(run: FmsRunRecord): boolean {
  if (run.Status !== "Pending" || !run.TAT_Deadline) return false;
  const deadline = parseStamp(run.TAT_Deadline);
  return deadline !== null && new Date() > deadline;
}

/**
 * The Dashboard's own FMS list — pending steps, plus anything completed today that hasn't
 * rolled past the end of the working day yet (see listMyDashboardFmsSteps()), so a step
 * doesn't disappear from the screen the instant it's marked Done.
 */
export default function FmsStepsWidget() {
  const t = useT();
  const [steps, setSteps] = useState<FmsRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/fms/my-steps?scope=dashboard")
      .then((res) => res.json())
      .then((data: { steps?: FmsRunRecord[] }) => {
        setSteps(data.steps ?? []);
      })
      .catch(() => toast.error(t("Steps load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  if (loading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>;
  }

  if (steps.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("Aaj koi FMS step nahi hai.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((run) => {
        const done = run.Status !== "Pending";
        return (
          <div
            key={run.Run_ID}
            className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm transition-colors duration-150 hover:bg-muted/50"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{run.Step_Name}</p>
                <span className="text-xs text-muted-foreground">{run.Template_Name}</span>
                {run.Quantity && (
                  <span className="text-xs text-muted-foreground">
                    Qty {run.Quantity}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                {t("Deadline")}: {formatDueDisplay(run.TAT_Deadline)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {done ? (
                <Badge variant={run.Status === "On Time" ? "default" : "secondary"}>
                  {run.Status}
                </Badge>
              ) : isOverdue(run) ? (
                <Badge variant="destructive">Not Done</Badge>
              ) : (
                <Badge variant="secondary">Pending</Badge>
              )}
              {!done && (
                <CompleteStepDialog run={run} onCompleted={() => setVersion((v) => v + 1)} />
              )}
            </div>
          </div>
        );
      })}
      <Button variant="outline" size="sm" render={<Link href="/fms">{t("Saare steps dekhein")}</Link>} />
    </div>
  );
}
