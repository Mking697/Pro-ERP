"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import { parseNextStepMap, parseOutcomeOptions } from "./template-format";
import { slugify } from "@/lib/id";
import {
  THIS_FLOW_SOURCE,
  serializeStepDataSourceConfig,
  parseStepDataSourceConfig,
  type FormField,
  type FormFieldType,
} from "@/lib/fms/dataSource";
import {
  OUTCOME_TYPE_DEFS,
  outcomeTypeDef,
  parseOutcomeType,
  type OutcomeType,
} from "@/lib/fms/outcomeType";
import {
  serializeActionConfig,
  parseActionType,
  parseLedgerMovementActionConfig,
  type ActionType,
  type LedgerMovementOutcomeAction,
} from "@/lib/fms/actions";
import type { FmsTemplateStepRecord } from "./types";

interface UserOption {
  userId: string;
  fullName: string;
}

interface ModuleOption {
  key: string;
  label: string;
  headers: string[];
}

interface DraftFormField {
  id: number;
  label: string;
  type: FormFieldType;
  required: boolean;
  optionsText: string; // comma-separated, only used when type === "dropdown"
  /** Auto-managed by the step's Outcome Type (e.g. Pass Qty/Fail Qty) — shown locked,
   * not removable, and regenerated whenever the Outcome Type changes. */
  builtIn?: boolean;
}

interface DraftStep {
  id: number;
  stepName: string;
  assignedTo: string;
  tatValue: string;
  tatUnit: "Hours" | "Days";
  /** "" keeps tatValue fixed; a 1-based step index sources the deadline from that
   * earlier step's own field instead (see outcomeType-independent TAT_Source_* columns). */
  tatSourceStepNo: string;
  tatSourceFieldKey: string;
  tatOffset: string;
  /** "" (Custom) keeps the original free-typed comma list; any other value is a preset
   * that fixes both outcomesText and the built-in fields below — see outcomeType.ts. */
  outcomeType: OutcomeType;
  outcomesText: string;
  /** outcome -> "END" or a 1-based step index as a string, keyed by the outcome text. */
  nextStepMap: Record<string, string>;
  /** Independent, not exclusive — a step can type a Form answer and see pulled reference
   * data at the same time (e.g. this stage's own Pass/Fail qty, plus the product's SKU). */
  useForm: boolean;
  useExisting: boolean;
  formFields: DraftFormField[];
  existingSourceModule: string; // a ModuleOption key, or THIS_FLOW_SOURCE
  existingSourceStepNo: string; // 1-based step index as a string, only for THIS_FLOW_SOURCE
  existingColumns: string[];
  existingFilterByContext: boolean;
  actionType: ActionType;
  /** Keyed by outcome text. */
  actionByOutcome: Record<string, LedgerMovementOutcomeAction & { uomField: string }>;
}

let nextId = 1;
function blankStep(): DraftStep {
  return {
    id: nextId++,
    stepName: "",
    assignedTo: "",
    tatValue: "",
    tatUnit: "Hours",
    tatSourceStepNo: "",
    tatSourceFieldKey: "",
    tatOffset: "0",
    outcomeType: "DONE",
    outcomesText: "Done",
    nextStepMap: { Done: "END" },
    useForm: false,
    useExisting: false,
    formFields: [],
    existingSourceModule: "",
    existingSourceStepNo: "",
    existingColumns: [],
    existingFilterByContext: true,
    actionType: "",
    actionByOutcome: {},
  };
}

function blankFormField(): DraftFormField {
  return { id: nextId++, label: "", type: "text", required: false, optionsText: "" };
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

/** Reconciles a step's per-outcome action config with its current outcome list — keeps a
 * choice already made for an outcome that's still there, defaults a new outcome to blank. */
function reconcileActionByOutcome(
  outcomes: string[],
  existing: Record<string, LedgerMovementOutcomeAction & { uomField: string }>
): Record<string, LedgerMovementOutcomeAction & { uomField: string }> {
  const next: Record<string, LedgerMovementOutcomeAction & { uomField: string }> = {};
  for (const o of outcomes) {
    next[o] = existing[o] ?? { direction: "In", skuField: "", qtyField: "", uomField: "" };
  }
  return next;
}

/** Field keys an Action can bind to — this step's own Form fields, plus whatever columns
 * its Existing-FMS pull brings in, whichever of the two (or both) are turned on. Never a
 * free-typed name, so a typo can't mis-wire a movement. */
function fieldKeyOptionsFor(step: DraftStep): string[] {
  const keys: string[] = [];
  if (step.useForm) keys.push(...step.formFields.map((f) => slugify(f.label)).filter(Boolean));
  if (step.useExisting) keys.push(...step.existingColumns);
  return keys;
}

/** The columns an "Existing FMS" source can offer to pick from — a module's real sheet
 * headers, or (for THIS_FLOW) the target step's own declared form field labels. */
function columnOptionsFor(step: DraftStep, allSteps: DraftStep[], modules: ModuleOption[]): string[] {
  if (step.existingSourceModule === THIS_FLOW_SOURCE) {
    const target = allSteps[Number(step.existingSourceStepNo) - 1];
    if (!target) return [];
    return [
      ...target.formFields.map((f) => slugify(f.label)).filter(Boolean),
      "Outcome",
      "Step_Name",
      "Quantity",
    ];
  }
  return modules.find((m) => m.key === step.existingSourceModule)?.headers ?? [];
}

/** The reverse of handleSubmit's payload building — turns a saved template's rows back
 * into editable draft state, for the Edit dialog. */
function hydrateSteps(records: FmsTemplateStepRecord[]): DraftStep[] {
  return records.map((r) => {
    const dataSource = parseStepDataSourceConfig(r.Data_Source_Config);
    const outcomeOptions = parseOutcomeOptions(r.Outcome_Options);
    const nextMap = parseNextStepMap(r.Next_Step_Map);
    const actionType = parseActionType(r.Action_Type);
    const actionConfigParsed = parseLedgerMovementActionConfig(r.Action_Config);
    const outcomeType = parseOutcomeType(r.Outcome_Type);
    const builtInKeys = new Set((outcomeTypeDef(outcomeType)?.builtInFields ?? []).map((f) => f.key));

    const actionByOutcome: Record<string, LedgerMovementOutcomeAction & { uomField: string }> = {};
    for (const o of outcomeOptions) {
      const a = actionConfigParsed[o];
      actionByOutcome[o] = a
        ? { direction: a.direction, skuField: a.skuField, qtyField: a.qtyField, uomField: a.uomField ?? "" }
        : { direction: "In", skuField: "", qtyField: "", uomField: "" };
    }

    return {
      id: nextId++,
      stepName: r.Step_Name,
      assignedTo: r.Assigned_To,
      tatValue: r.TAT_Value,
      tatUnit: r.TAT_Unit === "Days" ? "Days" : "Hours",
      tatSourceStepNo: r.TAT_Source_Step_No || "",
      tatSourceFieldKey: r.TAT_Source_Field_Key || "",
      tatOffset: r.TAT_Offset || "0",
      outcomeType,
      outcomesText: outcomeOptions.join(","),
      nextStepMap: nextMap,
      useForm: Boolean(dataSource.form),
      useExisting: Boolean(dataSource.existing),
      formFields: (dataSource.form?.fields ?? []).map((f) => ({
        id: nextId++,
        label: f.label,
        type: f.type,
        required: f.required,
        optionsText: (f.options ?? []).join(","),
        builtIn: builtInKeys.has(f.key),
      })),
      existingSourceModule: dataSource.existing?.sourceModule ?? "",
      existingSourceStepNo: dataSource.existing?.sourceStepNo
        ? String(dataSource.existing.sourceStepNo)
        : "",
      existingColumns: dataSource.existing?.columns ?? [],
      existingFilterByContext: dataSource.existing?.filterByContext ?? true,
      actionType,
      actionByOutcome,
    };
  });
}

function buildExistingConfig(step: DraftStep) {
  return {
    sourceModule: step.existingSourceModule,
    sourceStepNo:
      step.existingSourceModule === THIS_FLOW_SOURCE ? Number(step.existingSourceStepNo) : undefined,
    columns: step.existingColumns,
    filterByContext: step.existingFilterByContext,
  };
}

export interface EditingTemplate {
  templateId: string;
  templateName: string;
  triggerEvent: string;
  steps: FmsTemplateStepRecord[];
}

export default function FmsTemplateForm({
  onCreated,
  userOptions,
  editing,
}: {
  onCreated: () => void;
  userOptions: UserOption[];
  /** When set, the dialog edits this template instead of creating a new one — saving
   * writes a new version and archives the old one (see updateFmsTemplate). */
  editing?: EditingTemplate;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [templateName, setTemplateName] = useState(editing?.templateName ?? "");
  const [triggerEvent, setTriggerEvent] = useState(editing?.triggerEvent ?? "MANUAL");
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    editing ? hydrateSteps(editing.steps) : [blankStep()]
  );
  const [saving, setSaving] = useState(false);
  const [moduleOptions, setModuleOptions] = useState<ModuleOption[]>([]);

  useEffect(() => {
    fetch("/api/fms/modules")
      .then((res) => res.json())
      .then((data: { modules?: ModuleOption[] }) => setModuleOptions(data.modules ?? []))
      .catch(() => toast.error(t("Modules load nahi ho paye.")));
  }, [t]);

  function reset() {
    if (editing) {
      setTemplateName(editing.templateName);
      setTriggerEvent(editing.triggerEvent);
      setSteps(hydrateSteps(editing.steps));
    } else {
      setTemplateName("");
      setTriggerEvent("MANUAL");
      setSteps([blankStep()]);
    }
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
              actionByOutcome: reconcileActionByOutcome(
                parseOutcomeOptions(outcomesText),
                s.actionByOutcome
              ),
            }
          : s
      )
    );
  }

  /** Switching Outcome Type fixes the step's Outcome_Options and swaps in whatever
   * built-in fields that preset needs (Pass Qty/Fail Qty, a single Value, an Attachment)
   * — any custom fields the admin already added stay put. "" (Custom) instead falls back
   * to the original free-typed comma list. */
  function setStepOutcomeType(id: number, outcomeType: OutcomeType) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const def = outcomeTypeDef(outcomeType);
        const outcomes = def ? def.outcomes : parseOutcomeOptions(s.outcomesText || "Done");
        const outcomesText = outcomes.join(",");
        const customFields = s.formFields.filter((f) => !f.builtIn);
        const builtInFields: DraftFormField[] = (def?.builtInFields ?? []).map((f) => ({
          id: nextId++,
          label: f.label,
          type: f.type,
          required: f.required,
          optionsText: "",
          builtIn: true,
        }));
        return {
          ...s,
          outcomeType,
          outcomesText,
          nextStepMap: reconcileNextStepMap(outcomes, s.nextStepMap),
          actionByOutcome: reconcileActionByOutcome(outcomes, s.actionByOutcome),
          useForm: builtInFields.length > 0 ? true : s.useForm,
          formFields: [...builtInFields, ...customFields],
        };
      })
    );
  }

  function setFormField(stepId: number, fieldId: number, patch: Partial<DraftFormField>) {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, formFields: s.formFields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) }
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

      const dataSource: { form?: { fields: FormField[] }; existing?: ReturnType<typeof buildExistingConfig> } = {};
      if (s.useForm) {
        const fields: FormField[] = s.formFields
          .filter((f) => f.label.trim())
          .map((f) => ({
            key: slugify(f.label),
            label: f.label.trim(),
            type: f.type,
            required: f.required,
            options:
              f.type === "dropdown"
                ? f.optionsText.split(",").map((o) => o.trim()).filter(Boolean)
                : undefined,
          }));
        dataSource.form = { fields };
      }
      if (s.useExisting && s.existingSourceModule) {
        dataSource.existing = buildExistingConfig(s);
      }
      const dataSourceConfig = serializeStepDataSourceConfig(dataSource);

      let actionConfig = "";
      if (s.actionType === "LEDGER_MOVEMENT") {
        const config: Record<string, LedgerMovementOutcomeAction | null> = {};
        for (const o of outcomeOptions) {
          const a = s.actionByOutcome[o];
          config[o] =
            a && a.skuField && a.qtyField
              ? { direction: a.direction, skuField: a.skuField, qtyField: a.qtyField, uomField: a.uomField || undefined }
              : null;
        }
        actionConfig = serializeActionConfig(config);
      }

      return {
        stepNo: index + 1,
        stepName: s.stepName.trim(),
        assignedTo: s.assignedTo,
        tatValue: Number(s.tatValue),
        tatUnit: s.tatUnit,
        outcomeOptions,
        nextStepMap,
        dataSourceConfig,
        actionType: s.actionType,
        actionConfig,
        outcomeType: s.outcomeType,
        tatSourceStepNo: s.tatSourceStepNo,
        tatSourceFieldKey: s.tatSourceFieldKey,
        tatOffset: Number(s.tatOffset) || 0,
      };
    });

    if (payloadSteps.some((s) => !s.stepName || !s.assignedTo || !(s.tatValue > 0))) {
      toast.error(t("Har step ka naam, assignee, aur TAT bharein."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        editing ? `/api/fms/templates/${editing.templateId}` : "/api/fms/templates",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateName, triggerEvent, steps: payloadSteps }),
        }
      );
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Template save nahi hui."));
        return;
      }

      toast.success(
        editing
          ? t("Naya version ban gaya, purana Archive ho gaya.")
          : t("FMS template ban gaya.")
      );
      reset();
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editing ? (
            <Button variant="outline" size="sm">
              {t("Edit")}
            </Button>
          ) : (
            <Button>{t("Naya FMS Template")}</Button>
          )
        }
      />
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t("Template Edit karein") : t("Naya FMS Template")}</DialogTitle>
          <DialogDescription>
            {editing
              ? t(
                  "Save karne par ek naya version banega aur purana version Archive ho jaayega — jo instance abhi chal raha hai wo purane version se hi chalta rahega, kisi ke beech me kuch nahi badlega."
                )
              : t(
                  "Ek step ka outcome decide karta hai agla kaunsa step chalega. \"MANUAL\" trigger sirf haath se start hota hai — koi module-event ya doosre FMS template ka outcome key (e.g. INWARD_ENTRY_CREATED) bhi de sakte hain."
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

                  {index > 0 && (
                    <div className="space-y-2 rounded-md border p-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={step.tatSourceStepNo !== ""}
                          onCheckedChange={(checked) =>
                            setStep(step.id, {
                              tatSourceStepNo: checked === true ? "1" : "",
                              tatSourceFieldKey: checked === true ? step.tatSourceFieldKey : "",
                            })
                          }
                        />
                        {t("Deadline pichle step ke field se nikaale (TAT ke bajaye)")}
                      </label>

                      {step.tatSourceStepNo !== "" && (
                        <div className="grid gap-2 pt-1 sm:grid-cols-3">
                          <Select
                            value={step.tatSourceStepNo}
                            onValueChange={(value) =>
                              value &&
                              setStep(step.id, { tatSourceStepNo: value, tatSourceFieldKey: "" })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t("Kaunsa step")} />
                            </SelectTrigger>
                            <SelectContent>
                              {steps.slice(0, index).map((_, i) => (
                                <SelectItem key={i} value={String(i + 1)}>
                                  {t("Step")} {i + 1}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={step.tatSourceFieldKey || "NONE"}
                            onValueChange={(value) =>
                              value &&
                              setStep(step.id, {
                                tatSourceFieldKey: value === "NONE" ? "" : value,
                              })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t("Kaunsa field")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">{t("Kaunsa field")}</SelectItem>
                              {(steps[Number(step.tatSourceStepNo) - 1]?.formFields ?? [])
                                .map((f) => slugify(f.label))
                                .filter(Boolean)
                                .map((key) => (
                                  <SelectItem key={key} value={key}>
                                    {key}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            step="any"
                            value={step.tatOffset}
                            onChange={(e) => setStep(step.id, { tatOffset: e.target.value })}
                            placeholder={t("Offset (+/-)")}
                          />
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "Jaise: Step 1 me 'Lead Days' bhara, is step ka offset -1 rakhne se deadline (Lead Days − 1) ban jaati hai — TAT box sirf fallback hai agar value na mile."
                        )}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor={`step-outcome-type-${step.id}`}>{t("Outcome Type")}</Label>
                    <Select
                      value={step.outcomeType || "CUSTOM"}
                      onValueChange={(value) =>
                        value &&
                        setStepOutcomeType(step.id, value === "CUSTOM" ? "" : (value as OutcomeType))
                      }
                    >
                      <SelectTrigger id={`step-outcome-type-${step.id}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OUTCOME_TYPE_DEFS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {t(d.label)}
                          </SelectItem>
                        ))}
                        <SelectItem value="CUSTOM">{t("Custom (khud likhein)")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {step.outcomeType === "" && (
                      <Input
                        value={step.outcomesText}
                        onChange={(e) => setStepOutcomes(step.id, e.target.value)}
                        placeholder="Pass,Fail"
                      />
                    )}
                  </div>

                  {outcomes.length > 0 && (
                    <div className="space-y-2 rounded-md bg-muted/40 p-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("Har outcome ke baad agla step")}
                      </p>
                      {step.outcomeType === "PASS_FAIL_QTY" && (
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "Fail Qty hamesha isi step par, usi doer ke paas, rework ke liye wapas aati hai — koi step yahan select nahi hota. Sirf Pass Qty ke liye agla step chunein."
                          )}
                        </p>
                      )}
                      {(step.outcomeType === "PASS_FAIL_QTY"
                        ? outcomes.filter((o) => o !== "Fail")
                        : outcomes
                      ).map((outcome) => (
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
                              <SelectItem value="END">{t("FMS khatam")}</SelectItem>
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

                  <div className="space-y-2 rounded-md border p-2">
                    <Label>{t("Data Source")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("Dono ek saath chuna ja sakta hai — jaise ek step apna Pass/Fail khud type kare, aur saath me pichle step ka data bhi dekhe.")}
                    </p>
                    <div className="flex flex-wrap gap-4 pt-1">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={step.useForm}
                          disabled={step.formFields.some((f) => f.builtIn)}
                          onCheckedChange={(checked) => setStep(step.id, { useForm: checked === true })}
                        />
                        {t("Naya Form")}
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={step.useExisting}
                          onCheckedChange={(checked) => setStep(step.id, { useExisting: checked === true })}
                        />
                        {t("Existing FMS se")}
                      </label>
                    </div>

                    {step.useForm && (
                      <div className="space-y-2 pt-2">
                        {step.formFields.map((field) =>
                          field.builtIn ? (
                            <div
                              key={field.id}
                              className="flex items-center justify-between gap-2 rounded-md bg-muted/40 p-2 text-sm"
                            >
                              <span>
                                🔒 {field.label} <span className="text-muted-foreground">({t(field.type)})</span>
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t("Outcome Type se auto-add hua")}
                              </span>
                            </div>
                          ) : (
                            <div key={field.id} className="space-y-2 rounded-md bg-muted/40 p-2">
                              <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                                <Input
                                  value={field.label}
                                  onChange={(e) =>
                                    setFormField(step.id, field.id, { label: e.target.value })
                                  }
                                  placeholder={t("Question ka naam")}
                                />
                                <Select
                                  value={field.type}
                                  onValueChange={(value) =>
                                    value &&
                                    setFormField(step.id, field.id, { type: value as FormFieldType })
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="text">{t("Text")}</SelectItem>
                                    <SelectItem value="number">{t("Number")}</SelectItem>
                                    <SelectItem value="date">{t("Date")}</SelectItem>
                                    <SelectItem value="dropdown">{t("Dropdown")}</SelectItem>
                                    <SelectItem value="attachment">{t("Attachment")}</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setStep(step.id, {
                                      formFields: step.formFields.filter((f) => f.id !== field.id),
                                    })
                                  }
                                >
                                  {t("Hatayein")}
                                </Button>
                              </div>
                              {field.type === "dropdown" && (
                                <Input
                                  value={field.optionsText}
                                  onChange={(e) =>
                                    setFormField(step.id, field.id, { optionsText: e.target.value })
                                  }
                                  placeholder={t("Options (comma se alag)")}
                                />
                              )}
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={field.required}
                                  onCheckedChange={(checked) =>
                                    setFormField(step.id, field.id, { required: checked === true })
                                  }
                                />
                                {t("Zaroori")}
                              </label>
                            </div>
                          )
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setStep(step.id, { formFields: [...step.formFields, blankFormField()] })
                          }
                        >
                          {t("Ek aur question")}
                        </Button>
                      </div>
                    )}

                    {step.useExisting && (
                      <div className="space-y-2 pt-2">
                        <Select
                          value={step.existingSourceModule}
                          onValueChange={(value) =>
                            value &&
                            setStep(step.id, { existingSourceModule: value, existingColumns: [] })
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("Source chunein")} />
                          </SelectTrigger>
                          <SelectContent>
                            {index > 0 && (
                              <SelectItem value={THIS_FLOW_SOURCE}>
                                {t("Isi FMS ka pehle wala step")}
                              </SelectItem>
                            )}
                            {moduleOptions.map((m) => (
                              <SelectItem key={m.key} value={m.key}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {step.existingSourceModule === THIS_FLOW_SOURCE && (
                          <Select
                            value={step.existingSourceStepNo}
                            onValueChange={(value) =>
                              value &&
                              setStep(step.id, { existingSourceStepNo: value, existingColumns: [] })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t("Kaunsa step")} />
                            </SelectTrigger>
                            <SelectContent>
                              {steps.slice(0, index).map((_, i) => (
                                <SelectItem key={i} value={String(i + 1)}>
                                  {t("Step")} {i + 1}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}

                        {step.existingSourceModule && (
                          <div className="space-y-1 rounded-md bg-muted/40 p-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              {t("Columns")}
                            </p>
                            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                              {columnOptionsFor(step, steps, moduleOptions).map((col) => (
                                <label key={col} className="flex items-center gap-1.5 text-sm">
                                  <Checkbox
                                    checked={step.existingColumns.includes(col)}
                                    onCheckedChange={(checked) =>
                                      setStep(step.id, {
                                        existingColumns:
                                          checked === true
                                            ? [...step.existingColumns, col]
                                            : step.existingColumns.filter((c) => c !== col),
                                      })
                                    }
                                  />
                                  {col}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}

                        {step.existingSourceModule && step.existingSourceModule !== THIS_FLOW_SOURCE && (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={step.existingFilterByContext}
                              onCheckedChange={(checked) =>
                                setStep(step.id, { existingFilterByContext: checked === true })
                              }
                            />
                            {t("Sirf isi instance ka record (condition)")}
                          </label>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 rounded-md border p-2">
                    <Label htmlFor={`step-action-${step.id}`}>{t("Action")}</Label>
                    <Select
                      value={step.actionType || "NONE"}
                      onValueChange={(value) =>
                        value &&
                        setStep(step.id, { actionType: value === "NONE" ? "" : (value as ActionType) })
                      }
                    >
                      <SelectTrigger id={`step-action-${step.id}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">{t("Koi nahi")}</SelectItem>
                        <SelectItem value="LEDGER_MOVEMENT">{t("Stock Ledger Movement")}</SelectItem>
                      </SelectContent>
                    </Select>

                    {step.actionType === "LEDGER_MOVEMENT" && (
                      <div className="space-y-2 pt-1">
                        {outcomes.length === 0 && (
                          <p className="text-xs text-muted-foreground">{t("Pehle Outcomes bharein.")}</p>
                        )}
                        {(() => {
                          const fieldOptions = fieldKeyOptionsFor(step);
                          return outcomes.map((outcome) => {
                            const a = step.actionByOutcome[outcome] ?? {
                              direction: "In" as const,
                              skuField: "",
                              qtyField: "",
                              uomField: "",
                            };
                            function updateAction(patch: Partial<typeof a>) {
                              setStep(step.id, {
                                actionByOutcome: {
                                  ...step.actionByOutcome,
                                  [outcome]: { ...a, ...patch },
                                },
                              });
                            }
                            return (
                              <div key={outcome} className="space-y-1.5 rounded-md bg-muted/40 p-2">
                                <p className="text-xs font-medium">{outcome}</p>
                                <div className="grid gap-1.5 sm:grid-cols-2">
                                  <Select
                                    value={a.direction}
                                    onValueChange={(v) => v && updateAction({ direction: v as "In" | "Out" })}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="In">In</SelectItem>
                                      <SelectItem value="Out">Out</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={a.skuField || "NONE"}
                                    onValueChange={(v) => v && updateAction({ skuField: v === "NONE" ? "" : v })}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder={t("SKU field")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="NONE">{t("SKU field")}</SelectItem>
                                      {fieldOptions.map((f) => (
                                        <SelectItem key={f} value={f}>
                                          {f}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={a.qtyField || "NONE"}
                                    onValueChange={(v) => v && updateAction({ qtyField: v === "NONE" ? "" : v })}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder={t("Qty field")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="NONE">{t("Qty field")}</SelectItem>
                                      {fieldOptions.map((f) => (
                                        <SelectItem key={f} value={f}>
                                          {f}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Select
                                    value={a.uomField || "NONE"}
                                    onValueChange={(v) => v && updateAction({ uomField: v === "NONE" ? "" : v })}
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder={t("UOM field (optional)")} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="NONE">{t("Item ka UOM use karein")}</SelectItem>
                                      {fieldOptions.map((f) => (
                                        <SelectItem key={f} value={f}>
                                          {f}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
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
              {saving ? "Saving..." : editing ? t("Naya version save karein") : t("Template banayein")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
