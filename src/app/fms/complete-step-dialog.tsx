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
import { Input } from "@/components/ui/input";
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
import FileUploadField from "@/components/file-upload-field";
import type { FmsRunRecord } from "./types";
import type { FormDataSourceConfig } from "@/lib/fms/dataSource";
import { parseOutcomeType, deriveOutcomeFromQty } from "@/lib/fms/outcomeType";

interface StepContext {
  outcomeOptions: string[];
  outcomeType: string;
  formConfig: FormDataSourceConfig | null;
  referenceRows: Record<string, string>[];
}

export default function CompleteStepDialog({
  run,
  onCompleted,
}: {
  run: FmsRunRecord;
  onCompleted: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<StepContext | null>(null);
  const [outcome, setOutcome] = useState("");
  const [remark, setRemark] = useState("");
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // `context` starting null (and staying null until the fetch resolves) is itself the
  // loading signal — no separate boolean to keep in sync with it.
  const loadingContext = open && context === null;
  const fallbackOutcomes = (run.Outcome_Options ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  useEffect(() => {
    if (!open || context) return;
    fetch(`/api/fms/steps/${run.Run_ID}`)
      .then((res) => res.json())
      .then((data: StepContext) => {
        setContext(data);
        setOutcome(data.outcomeOptions?.[0] ?? "");
      })
      .catch(() => {
        toast.error(t("Step ki details load nahi ho payi."));
        // Fall back to a plain Outcome/Remark dialog rather than staying stuck loading.
        setContext({ outcomeOptions: fallbackOutcomes, outcomeType: "", formConfig: null, referenceRows: [] });
        setOutcome(fallbackOutcomes[0] ?? "");
      });
  }, [open, context, run.Run_ID, t, fallbackOutcomes]);

  const outcomeType = parseOutcomeType(context?.outcomeType);
  // PASS_FAIL_QTY has no Outcome to pick — the branch follows whatever quantities were
  // typed in, computed the same way the server independently re-derives it.
  const finalOutcome = outcomeType === "PASS_FAIL_QTY" ? deriveOutcomeFromQty(formValues) : outcome;

  async function handleComplete() {
    if (!finalOutcome) {
      toast.error(t("Outcome chunein."));
      return;
    }
    if (context?.formConfig) {
      const missing = (context.formConfig?.fields ?? []).filter(
        (f) => f.required && !formValues[f.key]?.trim()
      );
      if (missing.length > 0) {
        toast.error(`${t("Ye fields zaroori hain")}: ${missing.map((f) => f.label).join(", ")}`);
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/fms/steps/${run.Run_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: finalOutcome, remark, formData: formValues }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Step complete nahi ho paya."));
        return;
      }

      toast.success(t("Step complete ho gaya."));
      onCompleted();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  const outcomes = context?.outcomeOptions ?? fallbackOutcomes;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("Complete")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{run.Step_Name}</DialogTitle>
          <DialogDescription>{run.Template_Name}</DialogDescription>
        </DialogHeader>

        {loadingContext ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-4">
            {context && context.referenceRows.length > 0 && (
              <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
                {context.referenceRows.map((row, i) => (
                  <div key={i} className="space-y-0.5">
                    {Object.entries(row).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-medium">{value || "—"}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {context?.formConfig?.fields.map((field) =>
              field.type === "attachment" ? (
                <FileUploadField
                  key={field.key}
                  label={`${field.label}${field.required ? " *" : ""}`}
                  value={formValues[field.key] ?? ""}
                  onChange={(url) => setFormValues((prev) => ({ ...prev, [field.key]: url }))}
                />
              ) : (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`field-${field.key}`}>
                    {field.label}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {field.type === "dropdown" ? (
                    <Select
                      value={formValues[field.key] ?? ""}
                      onValueChange={(value) =>
                        value && setFormValues((prev) => ({ ...prev, [field.key]: value }))
                      }
                    >
                      <SelectTrigger id={`field-${field.key}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`field-${field.key}`}
                      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                      value={formValues[field.key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  )}
                </div>
              )
            )}

            {/* PASS_FAIL_QTY derives its outcome from the qty fields above — no separate
                pick. A single-outcome step (Done, Number, Text, Attachment) has nothing
                to choose either — showing a one-item dropdown was never useful. */}
            {outcomeType !== "PASS_FAIL_QTY" && outcomes.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="outcome">Outcome</Label>
                <Select value={outcome} onValueChange={(value) => value && setOutcome(value)}>
                  <SelectTrigger id="outcome" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {outcomes.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="remark">{t("Remark (optional)")}</Label>
              <Textarea id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleComplete} disabled={loading || loadingContext || !finalOutcome}>
            {loading ? "Saving..." : t("Complete karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
