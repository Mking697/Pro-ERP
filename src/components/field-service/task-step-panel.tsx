"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import { CheckCircle2, Circle, Loader2, MapPin } from "lucide-react";
import EvidenceFile from "./evidence-file";
import { useDeviceLocation } from "./use-device-location";
import type { FieldTaskType } from "@/components/field-service/assign-doers-dialog";

export interface FieldStepData {
  sitePhotoUrl: string;
  siteVideoUrl: string;
  latitude: number | null;
  longitude: number | null;
  step1At: string;
  evidenceUrl: string;
  notes: string;
  chartUrl: string;
  step2At: string;
  expenseAmount: number | null;
  expenseNotes: string;
  billUrls: string[];
  step3At: string;
}

function StepHeader({ done, label }: { done: boolean; label: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      {done ? (
        <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
      ) : (
        <Circle aria-hidden="true" className="size-4 text-muted-foreground" />
      )}
      {t(label)}
    </div>
  );
}

/**
 * The Doer's shared 3-step field-completion flow, rendered against whichever step is
 * next for THIS task — read-only summary for everyone else. Mirrors the reference
 * app's own task-steps flow; see src/lib/fieldService/steps.ts for the exact semantics.
 */
export default function TaskStepPanel({
  taskType,
  taskId,
  cycle,
  isAssignedDoer,
  step,
  onUpdated,
}: {
  taskType: FieldTaskType;
  taskId: string;
  cycle: number;
  /** True only when the signed-in user is one of this task's own assigned Doers IN THE
   * ACTIVE CYCLE — the one tier of caller allowed to actually submit a step. */
  isAssignedDoer: boolean;
  step: FieldStepData | null;
  onUpdated: (step: FieldStepData) => void;
}) {
  const t = useT();
  const [sitePhotoUrl, setSitePhotoUrl] = useState("");
  const [siteVideoUrl, setSiteVideoUrl] = useState("");
  const { coords, locating, error: locationError, locate } = useDeviceLocation(isAssignedDoer && !step?.step1At);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [chartUrl, setChartUrl] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [billUrl, setBillUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => { submission.current?.abort(); }, []);

  async function submit(step1or2or3: 1 | 2 | 3, body: Record<string, unknown>) {
    if (submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setSubmitting(true);
    try {
      const res = await fetch("/api/field-service/steps", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType, taskId, cycle, step: step1or2or3, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !data?.step) {
        toast.error(t(data?.error ?? "Step save nahi hua."));
        return;
      }
      toast.success(t("Step save ho gaya."));
      onUpdated(data.step);
    } catch (error) {
      if (!controller.signal.aborted) toast.error(t(error instanceof Error ? error.message : "Step save nahi hua."));
    } finally {
      submission.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  const stepDone = (n: 1 | 2 | 3) => Boolean(step && (n === 1 ? step.step1At : n === 2 ? step.step2At : step.step3At));

  const canDoStep1 = isAssignedDoer && !stepDone(1);
  const canDoStep2 = isAssignedDoer && stepDone(1) && !stepDone(2);
  const canDoStep3 = isAssignedDoer && stepDone(2) && !stepDone(3);

  return (
    <div className="space-y-4">
      {/* Step 1 — site photo/video + location */}
      <div className="space-y-3 rounded-lg border p-3">
        <StepHeader done={stepDone(1)} label={t("Step 1 — Site Photo & Location")} />
        {canDoStep1 ? (
          <div className="space-y-3">
            <FileUploadField label={t("Site Photo")} value={sitePhotoUrl} onChange={setSitePhotoUrl} />
            <FileUploadField label={t("Site Video (optional)")} value={siteVideoUrl} onChange={setSiteVideoUrl} />
            <div className="flex items-center gap-2 text-sm">
              <MapPin aria-hidden="true" className="size-4 text-muted-foreground" />
              {locating ? (
                <span className="text-muted-foreground">{t("Location le rahe hain...")}</span>
              ) : coords ? (
                <span>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
              ) : (
                <span className="text-muted-foreground">{t("Location nahi mili — permission allow karein.")}</span>
              )}
            </div>
            {locationError && <p role="alert" className="text-sm text-destructive">{t("Location nahi mili — permission allow karein.")}</p>}
            <Button type="button" size="sm" variant="outline" disabled={locating || submitting} onClick={locate}>{t("GPS retry karein")}</Button>
            <Button
              size="sm"
              disabled={submitting || locating || !sitePhotoUrl || !coords}
              onClick={() =>
                coords &&
                submit(1, { sitePhotoUrl, siteVideoUrl, latitude: coords.lat, longitude: coords.lng })
              }
            >
              {submitting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {t("Step 1 Complete Karein")}
            </Button>
          </div>
        ) : stepDone(1) ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <EvidenceFile url={step?.sitePhotoUrl ?? ""} label={t("Site Photo")} />
            <EvidenceFile url={step?.siteVideoUrl ?? ""} label={t("Site Video (optional)")} video />
            <p>{step?.step1At && new Date(step.step1At).toLocaleString("en-IN")}</p>
            {step?.latitude != null && step?.longitude != null && (
              <p>{t("Location")}: {Number(step.latitude).toFixed(5)}, {Number(step.longitude).toFixed(5)}</p>
            )}
          </div>
        ) : null}
      </div>

      {/* Step 2 — evidence (Service/Complaint) or notes+chart (Site Visit) */}
      <div className="space-y-3 rounded-lg border p-3">
        <StepHeader done={stepDone(2)} label={t("Step 2 — Work Evidence")} />
        {canDoStep2 ? (
          <div className="space-y-3">
            {taskType === "SITE_VISIT" ? (
              <>
                <div className="space-y-2">
                  <Label>{t("Visit Details")}</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                <FileUploadField label={t("Site Chart / Calculation")} value={chartUrl} onChange={setChartUrl} />
              </>
            ) : (
              <FileUploadField label={t("Work-Complete Evidence")} value={evidenceUrl} onChange={setEvidenceUrl} />
            )}
            <Button
              size="sm"
              disabled={submitting || (taskType === "SITE_VISIT" ? !notes.trim() : !evidenceUrl)}
              onClick={() => submit(2, { evidenceUrl, notes, chartUrl })}
            >
              {submitting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {t("Step 2 Complete Karein")}
            </Button>
          </div>
        ) : stepDone(2) ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            {step?.notes && <p className="whitespace-pre-wrap">{step.notes}</p>}
            <EvidenceFile url={step?.evidenceUrl ?? ""} label={t("Work-Complete Evidence")} />
            <EvidenceFile url={step?.chartUrl ?? ""} label={t("Site Chart / Calculation")} />
            <p>{step?.step2At && new Date(step.step2At).toLocaleString("en-IN")}</p>
          </div>
        ) : null}
      </div>

      {/* Step 3 — expense + bills */}
      <div className="space-y-3 rounded-lg border p-3">
        <StepHeader done={stepDone(3)} label={t("Step 3 — Expense")} />
        {canDoStep3 ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("Expense Amount (₹)")}</Label>
                <Input type="number" min="0" step="0.01" value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("Expense Notes")}</Label>
                <Input value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} />
              </div>
            </div>
            <FileUploadField label={t("Bill (optional)")} value={billUrl} onChange={setBillUrl} />
            <Button
              size="sm"
              disabled={submitting || expenseAmount.trim() === "" || !Number.isFinite(Number(expenseAmount)) || Number(expenseAmount) < 0}
              onClick={() =>
                submit(3, {
                  expenseAmount: Number(expenseAmount),
                  expenseNotes,
                  billUrls: billUrl ? [billUrl] : [],
                })
              }
            >
              {submitting ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {t("Task Complete Karein")}
            </Button>
          </div>
        ) : stepDone(3) ? (
          <div className="text-sm text-muted-foreground">
            {step?.expenseAmount != null && <p>₹{step.expenseAmount} {step.expenseNotes}</p>}
            {step?.billUrls.map((url, index) => <EvidenceFile key={`${index}:${url}`} url={url} label={t("Bill")} />)}
            <p>{step?.step3At && new Date(step.step3At).toLocaleString("en-IN")}</p>
          </div>
        ) : null}
      </div>

      {!isAssignedDoer && !stepDone(1) && (
        <p className="text-sm text-muted-foreground">
          {t("Ye task abhi kisi assigned Doer ka wait kar raha hai.")}
        </p>
      )}
    </div>
  );
}
