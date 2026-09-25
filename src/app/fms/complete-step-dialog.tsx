"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import type { FormDataSourceConfig, FormField } from "@/lib/fms/dataSource";
import { parseOutcomeType, deriveOutcomeFromQty, qtySplitTotal } from "@/lib/fms/outcomeType";
import type { Translator } from "@/lib/i18n";
import { useComboboxNav, comboboxListId, comboboxOptionId } from "@/components/ui/combobox";

/**
 * A searchable picker for a "lookup" field — the doer types to filter, then picks a row
 * from `rows`. No cmdk/Popover primitive exists yet in this project's src/components/ui,
 * so this is a small self-contained combobox (Input + an absolutely-positioned list) built
 * from what's already here, rather than pulling in a new dependency for one field type.
 */
function LookupCombobox({
  id,
  rows,
  loading,
  displayField,
  value,
  onSelect,
  t,
}: {
  id?: string;
  rows: Record<string, string>[];
  loading: boolean;
  displayField: string;
  value: string;
  onSelect: (row: Record<string, string>) => void;
  t: Translator;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = rows.filter((r) =>
    (r[displayField] ?? "").toLowerCase().includes(search.trim().toLowerCase())
  );

  const { activeIndex, optionRefs, onKeyDown } = useComboboxNav({
    itemCount: filtered.length,
    open,
    onOpenChange: setOpen,
    onSelect: (index) => {
      const row = filtered[index];
      if (!row) return;
      onSelect(row);
      setOpen(false);
      setSearch("");
    },
  });

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={inputId}
        value={open ? search : value}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setSearch("");
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={loading ? t("Load ho raha hai...") : t("Search karein...")}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={comboboxListId(inputId)}
        aria-activedescendant={activeIndex >= 0 ? comboboxOptionId(inputId, activeIndex) : undefined}
        aria-autocomplete="list"
      />
      {open && (
        <div
          id={comboboxListId(inputId)}
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {loading ? (
            <p className="p-2 text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
          ) : filtered.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{t("Koi match nahi mila.")}</p>
          ) : (
            filtered.map((row, i) => (
              <button
                key={i}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                id={comboboxOptionId(inputId, i)}
                role="option"
                aria-selected={i === activeIndex}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                className={`block w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                  i === activeIndex ? "bg-accent text-accent-foreground" : ""
                }`}
                onClick={() => {
                  onSelect(row);
                  setOpen(false);
                  setSearch("");
                }}
              >
                {row[displayField] || "—"}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface StepContext {
  outcomeOptions: string[];
  outcomeType: string;
  quantity: string;
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
        setContext({
          outcomeOptions: fallbackOutcomes,
          outcomeType: "",
          quantity: run.Quantity ?? "",
          formConfig: null,
          referenceRows: [],
        });
        setOutcome(fallbackOutcomes[0] ?? "");
      });
  }, [open, context, run.Run_ID, run.Quantity, t, fallbackOutcomes]);

  // Rows for every "lookup" field's sourceModule, fetched once per module (not once per
  // field — two lookup fields on the same step pointed at the same module share a fetch).
  const [lookupRows, setLookupRows] = useState<Record<string, Record<string, string>[]>>({});
  const [lookupLoading, setLookupLoading] = useState<Record<string, boolean>>({});
  const fetchedLookupModules = useRef(new Set<string>());

  useEffect(() => {
    const lookupFields = (context?.formConfig?.fields ?? []).filter(
      (f): f is FormField & { lookup: NonNullable<FormField["lookup"]> } =>
        f.type === "lookup" && Boolean(f.lookup)
    );
    for (const field of lookupFields) {
      const sourceModule = field.lookup.sourceModule;
      if (fetchedLookupModules.current.has(sourceModule)) continue;
      fetchedLookupModules.current.add(sourceModule);
      setLookupLoading((prev) => ({ ...prev, [sourceModule]: true }));
      fetch(`/api/fms/lookup-source?module=${encodeURIComponent(sourceModule)}`)
        .then((res) => res.json())
        .then((data: { rows?: Record<string, string>[] }) => {
          setLookupRows((prev) => ({ ...prev, [sourceModule]: data.rows ?? [] }));
        })
        .catch(() => toast.error(t("Lookup list load nahi ho payi.")))
        .finally(() => setLookupLoading((prev) => ({ ...prev, [sourceModule]: false })));
    }
  }, [context, t]);

  /** A lookup field's own value autofills, and every mapped target field on this same step
   * gets that row's mapped column value — still visible/editable afterward, not locked.
   * The selected row's own generated id (whichever header ends in "_ID") is stashed under
   * `${field.key}__id`, not shown as a field, so a later chained step can resolve back to
   * the exact record instead of a fuzzy name match. */
  function applyLookupSelection(field: FormField, row: Record<string, string>) {
    const lookup = field.lookup;
    if (!lookup) return;
    setFormValues((prev) => {
      const next = { ...prev, [field.key]: row[lookup.displayField] ?? "" };
      for (const [targetKey, sourceColumn] of Object.entries(lookup.autofillMap)) {
        next[targetKey] = row[sourceColumn] ?? "";
      }
      const idHeader = Object.keys(row).find((h) => h.endsWith("_ID"));
      if (idHeader) next[`${field.key}__id`] = row[idHeader] ?? "";
      return next;
    });
  }

  const outcomeType = parseOutcomeType(context?.outcomeType);
  // PASS_FAIL_QTY has no Outcome to pick — the branch follows whatever quantities were
  // typed in, computed the same way the server independently re-derives it.
  const finalOutcome = outcomeType === "PASS_FAIL_QTY" ? deriveOutcomeFromQty(formValues) : outcome;

  async function handleComplete() {
    if (!finalOutcome) {
      toast.error(t("Outcome chunein."));
      return;
    }
    if (outcomeType === "PASS_FAIL_QTY" && context?.quantity) {
      const runQty = Number(context.quantity);
      const total = qtySplitTotal(formValues);
      if (Math.abs(total - runQty) > 1e-6) {
        toast.error(
          `Pass + Fail + Scrap Qty milakar ${runQty} honi chahiye (is step ki Quantity) — abhi ${total} hai.`
        );
        return;
      }
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
          <DialogDescription>
            {run.Template_Name}
            {context?.quantity && ` · Qty ${context.quantity}`}
          </DialogDescription>
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
                  ) : field.type === "lookup" && field.lookup ? (
                    <LookupCombobox
                      id={`field-${field.key}`}
                      rows={lookupRows[field.lookup.sourceModule] ?? []}
                      loading={Boolean(lookupLoading[field.lookup.sourceModule])}
                      displayField={field.lookup.displayField}
                      value={formValues[field.key] ?? ""}
                      onSelect={(row) => applyLookupSelection(field, row)}
                      t={t}
                    />
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
