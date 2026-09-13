"use client";

import { useState, type FormEvent } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import { parseOutcomeOptions } from "./template-format";

interface UserOption {
  userId: string;
  fullName: string;
}

interface DraftStep {
  id: number;
  stepName: string;
  assignedTo: string;
  tatValue: string;
  tatUnit: "Hours" | "Days";
  outcomesText: string;
  /** outcome -> "END" or a 1-based step index as a string, keyed by the outcome text. */
  nextStepMap: Record<string, string>;
}

let nextId = 1;
function blankStep(): DraftStep {
  return {
    id: nextId++,
    stepName: "",
    assignedTo: "",
    tatValue: "",
    tatUnit: "Hours",
    outcomesText: "Done",
    nextStepMap: { Done: "END" },
  };
}

/** Reconciles a step's next-step map with its current outcome list — keeps a choice
 * already made for an outcome that's still there, defaults a new outcome to "END". */
function reconcileNextStepMap(
  outcomes: string[],
  existing: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const o of outcomes) next[o] = existing[o] ?? "END";
  return next;
}

export default function FmsTemplateForm({
  onCreated,
  userOptions,
}: {
  onCreated: () => void;
  userOptions: UserOption[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("MANUAL");
  const [steps, setSteps] = useState<DraftStep[]>(() => [blankStep()]);
  const [saving, setSaving] = useState(false);

  function reset() {
    setTemplateName("");
    setTriggerEvent("MANUAL");
    setSteps([blankStep()]);
  }

  function setStep(id: number, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function setStepOutcomes(id: number, outcomesText: string) {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              outcomesText,
              nextStepMap: reconcileNextStepMap(parseOutcomeOptions(outcomesText), s.nextStepMap),
            }
          : s
      )
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!templateName.trim()) {
      toast.error(t("Template ka naam zaroori hai."));
      return;
    }

    const payloadSteps = steps.map((s, index) => {
      const outcomeOptions = parseOutcomeOptions(s.outcomesText);
      const nextStepMap: Record<string, number | "END"> = {};
      for (const o of outcomeOptions) {
        const target = s.nextStepMap[o] ?? "END";
        nextStepMap[o] = target === "END" ? "END" : Number(target);
      }
      return {
        stepNo: index + 1,
        stepName: s.stepName.trim(),
        assignedTo: s.assignedTo,
        tatValue: Number(s.tatValue),
        tatUnit: s.tatUnit,
        outcomeOptions,
        nextStepMap,
      };
    });

    if (payloadSteps.some((s) => !s.stepName || !s.assignedTo || !(s.tatValue > 0))) {
      toast.error(t("Har step ka naam, assignee, aur TAT bharein."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/fms/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateName, triggerEvent, steps: payloadSteps }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Template save nahi hui."));
        return;
      }

      toast.success(t("Flow template ban gaya."));
      reset();
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t("Naya Flow Template")}</Button>} />
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Naya Flow Template")}</DialogTitle>
          <DialogDescription>
            {t(
              "Ek step ka outcome decide karta hai agla kaunsa step chalega. \"MANUAL\" trigger sirf haath se start hota hai — koi module-event ya doosre flow ka outcome key (e.g. INWARD_ENTRY_CREATED) bhi de sakte hain."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="templateName">{t("Template ka naam")}</Label>
              <Input
                id="templateName"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Purchase Approval"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="triggerEvent">{t("Trigger")}</Label>
              <Input
                id="triggerEvent"
                value={triggerEvent}
                onChange={(e) => setTriggerEvent(e.target.value)}
                placeholder="MANUAL"
                className="font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-3">
            {steps.map((step, index) => {
              const outcomes = parseOutcomeOptions(step.outcomesText);
              return (
                <div key={step.id} className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {t("Step")} {index + 1}
                    </p>
                    {steps.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSteps((prev) => prev.filter((s) => s.id !== step.id))}
                      >
                        {t("Hatayein")}
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`step-name-${step.id}`}>{t("Step ka naam")}</Label>
                      <Input
                        id={`step-name-${step.id}`}
                        value={step.stepName}
                        onChange={(e) => setStep(step.id, { stepName: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`step-assignee-${step.id}`}>{t("Assigned To")}</Label>
                      <Select
                        value={step.assignedTo}
                        onValueChange={(value) => value && setStep(step.id, { assignedTo: value })}
                      >
                        <SelectTrigger id={`step-assignee-${step.id}`} className="w-full">
                          <SelectValue placeholder={t("User chunein")} />
                        </SelectTrigger>
                        <SelectContent>
                          {userOptions.map((u) => (
                            <SelectItem key={u.userId} value={u.userId}>
                              {u.fullName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                    <div className="space-y-2">
                      <Label htmlFor={`step-tat-${step.id}`}>TAT</Label>
                      <Input
                        id={`step-tat-${step.id}`}
                        type="number"
                        step="any"
                        min="0"
                        value={step.tatValue}
                        onChange={(e) => setStep(step.id, { tatValue: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`step-tat-unit-${step.id}`}>{t("Unit")}</Label>
                      <Select
                        value={step.tatUnit}
                        onValueChange={(value) =>
                          value && setStep(step.id, { tatUnit: value as "Hours" | "Days" })
                        }
                      >
                        <SelectTrigger id={`step-tat-unit-${step.id}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Hours">{t("Hours")}</SelectItem>
                          <SelectItem value="Days">{t("Days")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`step-outcomes-${step.id}`}>
                      {t("Outcomes (comma se alag)")}
                    </Label>
                    <Input
                      id={`step-outcomes-${step.id}`}
                      value={step.outcomesText}
                      onChange={(e) => setStepOutcomes(step.id, e.target.value)}
                      placeholder="Pass,Fail"
                    />
                  </div>

                  {outcomes.length > 0 && (
                    <div className="space-y-2 rounded-md bg-muted/40 p-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("Har outcome ke baad agla step")}
                      </p>
                      {outcomes.map((outcome) => (
                        <div key={outcome} className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-sm">{outcome}</span>
                          <Select
                            value={step.nextStepMap[outcome] ?? "END"}
                            onValueChange={(value) =>
                              value &&
                              setStep(step.id, {
                                nextStepMap: { ...step.nextStepMap, [outcome]: value },
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="END">{t("Flow khatam")}</SelectItem>
                              {steps.map((_, targetIndex) => (
                                <SelectItem key={targetIndex} value={String(targetIndex + 1)}>
                                  {t("Step")} {targetIndex + 1}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSteps((prev) => [...prev, blankStep()])}
            >
              {t("Ek aur step")}
            </Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : t("Template banayein")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
