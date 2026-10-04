"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import { AlertTriangle } from "lucide-react";
import type { MaintenanceRequestRow, MyFmsStepOption } from "./types";

/**
 * Report Breakdown — the one form that actually pauses a Production Line step. Only
 * steps the signed-in user holds (their own "My Steps", same list the FMS page itself
 * shows) are offered, since reportBreakdown() enforces assignee-only server-side anyway —
 * showing someone else's step here would just be a guaranteed 400 on submit.
 */
export default function ReportBreakdownDialog({
  onReported,
}: {
  onReported: (request: MaintenanceRequestRow) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<MyFmsStepOption[]>([]);
  const [runId, setRunId] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [stepsLoading, setStepsLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/fms/my-steps")
      .then((res) => res.json())
      .then((data: { steps?: MyFmsStepOption[] }) => {
        if (cancelled) return;
        setSteps((data.steps ?? []).filter((s) => s.Status === "Pending"));
      })
      .catch(() => toast.error(t("Aapke running steps load nahi ho paye.")))
      .finally(() => {
        if (!cancelled) setStepsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, t]);

  async function handleSubmit() {
    if (!runId) {
      toast.error(t("Pehle Production Line ka step chunein."));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/maintenance/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "Breakdown report nahi ho paya."));
        return;
      }
      toast.success(t("Breakdown report hua — Production Line pause ho gayi."));
      onReported(data.request);
      setOpen(false);
      setRunId("");
      setDescription("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="destructive">
            <AlertTriangle className="size-4" />
            {t("Breakdown Report Karein")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Breakdown Report Karein")}</DialogTitle>
          <DialogDescription>
            {t("Jab tak resolve nahi hota, is Line ka step pause rahega — TAT count nahi hogi.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Production Line / Step")}</Label>
            <Select value={runId} onValueChange={(v) => setRunId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={stepsLoading ? t("Load ho raha hai...") : t("Step chunein")} />
              </SelectTrigger>
              <SelectContent>
                {steps.length === 0 && !stepsLoading && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {t("Aapke paas koi running step nahi hai.")}
                  </div>
                )}
                {steps.map((s) => (
                  <SelectItem key={s.Run_ID} value={s.Run_ID}>
                    {s.Template_Name} — {s.Step_Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="breakdown-description">{t("Kya kharabi hai")}</Label>
            <Textarea
              id="breakdown-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Jaise: motor seize ho gaya, seat leak ho rahi hai...")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={loading || !runId} variant="destructive">
            {loading ? t("Report ho raha hai...") : t("Breakdown Report Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
