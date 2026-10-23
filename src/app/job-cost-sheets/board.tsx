"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/preferences-provider";
import { JobCostSheetController } from "@/lib/job-costing/client";
import { jobCostDataEqual } from "@/lib/job-costing/readback";
import type { CostHead } from "@/lib/job-costing/types";
import type { JobCostBasis, JobChargeInput, JobGeneralClassification, JobHeadDecision } from "@/lib/job-costing/types";
import Snapshot from "./snapshot";

const control = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60";
const action = "rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
const dangerAction = "rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50";

const BASIS_BY_HEAD: Record<CostHead, JobCostBasis[]> = {
  Labour: ["LabourHours", "PerPiece"],
  DirectExpense: ["Batch"],
  FactoryOverhead: ["PerGoodUnit", "LabourHours", "MachineHours"],
  Commercial: ["Batch", "PerGoodUnit"],
};
const SENTINEL_BASIS = new Set<JobCostBasis>(["Batch", "PerGoodUnit"]);

export default function JobCostSheetsBoard({ initialPlanId, initialDate }: { initialPlanId: string; initialDate: string }) {
  const t = useT();
  const [controller] = useState(() => new JobCostSheetController({ planId: initialPlanId, asOfDate: initialDate, headDecisions: [], charges: [], generalDecisions: [] }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const { input, saved, preview } = state;
  const blocked = state.busy || !!state.pending || !!state.advanced || state.reading;
  const ready = !!input.planId && !!input.asOfDate;
  const sameSaved = !!saved && jobCostDataEqual(input, saved.calculation.input) && jobCostDataEqual(preview, saved.calculation);
  const heads: [CostHead, string][] = [["Labour", t("Labour")], ["DirectExpense", t("Direct expenses")], ["FactoryOverhead", t("Factory overhead")], ["Commercial", t("Commercial allocations")]];
  const basisLabel: Record<JobCostBasis, string> = { Batch: t("Batch"), PerGoodUnit: t("Per good unit"), LabourHours: t("LabourHours"), MachineHours: t("MachineHours"), PerPiece: t("PerPiece") };
  const classificationLabel: Record<JobGeneralClassification, string> = { DirectExpense: t("Direct expense"), FactoryOverhead: t("Factory overhead"), Commercial: t("Commercial"), ExcludedCapital: t("Excluded — capital"), ExcludedOther: t("Excluded — other reason") };

  useEffect(() => { controller.activate(); void controller.plansList(); return () => controller.dispose(); }, [controller]);
  useEffect(() => { if (input.planId) void controller.history(); }, [controller, input.planId, saved?.id, saved?.version]);

  const headDecisionFor = (head: CostHead): JobHeadDecision => input.headDecisions.find(d => d.head === head) ?? { head, status: "NotApplicable", reason: "" };
  const setHeadDecision = (head: CostHead, patch: Partial<JobHeadDecision>) => {
    const current = headDecisionFor(head);
    controller.edit({ ...input, headDecisions: [...input.headDecisions.filter(d => d.head !== head), { ...current, ...patch }] });
  };
  const editCharge = (index: number, patch: Partial<JobChargeInput>) => controller.edit({ ...input, charges: input.charges.map((charge, i) => i === index ? { ...charge, ...patch } : charge) });
  const addCharge = () => controller.edit({ ...input, charges: [...input.charges, { id: crypto.randomUUID(), head: "Labour", description: "", basis: "LabourHours", quantity: "0", rate: "", reason: "", evidenceRef: "" }] });
  const decisionFor = (lineId: string) => input.generalDecisions.find(d => d.lineId === lineId) ?? { lineId, classification: "ExcludedOther" as JobGeneralClassification, allocatedAmount: "0.00", basis: "", reason: "" };
  const setDecision = (lineId: string, patch: Partial<{ classification: JobGeneralClassification; allocatedAmount: string; basis: string; reason: string }>) => {
    const current = decisionFor(lineId);
    controller.edit({ ...input, generalDecisions: [...input.generalDecisions.filter(d => d.lineId !== lineId), { ...current, ...patch }] });
  };

  return <div className="min-w-0 space-y-6" aria-busy={state.busy || state.reading}>
    {state.error && <p role="alert" className="break-words rounded-md border border-destructive p-3 text-sm">{state.error}</p>}
    {state.notice === "saved" && <p role="status">{t("Saved snapshot readback verified.")}</p>}
    {state.notice === "finalized" && <p role="status">{t("Sheet finalized. Finalized sheets change only through a new revision that explicitly supersedes it.")}</p>}
    {state.advanced && <section role="status" className="space-y-3 rounded-md border border-amber-500 p-4">
      <p>{t("Request accepted, lekin saved sheet kisi aur update se aage badh chuki hai. Current calculation accepted snapshot nahi hai. Inputs abhi replace nahi hue; current snapshot load karne par replace honge.")}</p>
      <p>{state.advanced.accepted.id} · {t("Version")} {state.advanced.accepted.version} → {state.advanced.current.version}</p>
      <button type="button" className={action} disabled={state.busy || state.reading} onClick={() => controller.loadCurrent()}>{t("Load current snapshot / replace inputs")}</button>
    </section>}
    {state.pending && <section role="status" className="space-y-3 rounded-md border border-amber-500 p-4">
      <p>{t("Request ka outcome unresolved hai. Wahi exact request retry karein; duplicate naya sheet na banayein. Reload karne se pehle history verify karein.")}</p>
      <button type="button" className={action} disabled={state.busy} onClick={() => controller.retry()}>{t("Retry same request")}</button>
    </section>}

    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("Eligible production plans")}</h2>
      <p className="text-sm text-muted-foreground">{t("Completed, non-FMS plans are finalizable once valued. In-progress plans may only preview/save an incomplete Draft. FMS Production-Line plans are visible with diagnostics but not finalizable in this slice.")}</p>
      <button type="button" className={action} disabled={blocked} onClick={() => controller.plansList()}>{t("Refresh plans")}</button>
      <ul className="space-y-2">{state.plans.map(p => <li key={p.planId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <div className="min-w-0 break-words"><p>{p.productName} · {p.productSku} · {t("Job No")} {p.jobNo || t("Unavailable")}</p><p>{t("Plan status")}: {p.status} · {p.reason}</p></div>
        <button type="button" className={action} disabled={blocked} onClick={() => { setConfirmFinalize(false); controller.edit({ ...input, planId: p.planId }); }}>{t("Select plan")}</button>
      </li>)}</ul>
      {!state.plans.length && <p className="text-sm text-muted-foreground">{t("No eligible plans loaded. Refresh plans to retry.")}</p>}
    </section>

    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("Sheet inputs")}</h2>
      <p role="status" className="rounded border border-amber-500 p-3 text-sm">{t("Provisional management valuation only — not proven historical cost, GL posting or stock revaluation. Material issue/output basis is recorded evidence (completion ledger), not independently measured consumption or QC-accepted good output.")}</p>
      <fieldset disabled={blocked} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div><label htmlFor="jcs-plan" className="mb-1 block text-sm">{t("Plan ID")}</label><input id="jcs-plan" className={control} value={input.planId} onChange={e => controller.edit({ ...input, planId: e.target.value })} /></div>
        <div><label htmlFor="jcs-date" className="mb-1 block text-sm">{t("As of date (IST)")}</label><input id="jcs-date" className={control} type="date" value={input.asOfDate} onChange={e => controller.edit({ ...input, asOfDate: e.target.value })} /></div>
      </fieldset>

      <fieldset disabled={blocked} className="space-y-3">
        <legend className="mb-2 font-medium">{t("Cost head decisions")}</legend>
        {heads.map(([head, label]) => { const d = headDecisionFor(head); return <div key={head} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-3">
          <div className="font-medium">{label}</div>
          <div><label htmlFor={`head-status-${head}`}>{t("Status")}</label><select id={`head-status-${head}`} className={control} value={d.status} onChange={e => setHeadDecision(head, { status: e.target.value as JobHeadDecision["status"] })}><option value="Entered">{t("Entered")}</option><option value="NotApplicable">{t("Not applicable")}</option></select></div>
          <div><label htmlFor={`head-reason-${head}`}>{t("Reason")}</label><input id={`head-reason-${head}`} className={control} value={d.reason} onChange={e => setHeadDecision(head, { reason: e.target.value })} /></div>
        </div>; })}
      </fieldset>

      <fieldset disabled={blocked} className="space-y-4">
        <legend className="mb-2 font-medium">{t("Approved manual charges")}</legend>
        <p className="text-sm text-muted-foreground">{t("Batch/Per good unit basis quantity is fixed at 1. Hours/piece bases require an explicit quantity. Evidence reference cannot duplicate a sourced material/General PO identity.")}</p>
        {input.charges.map((charge, i) => { const sentinel = SENTINEL_BASIS.has(charge.basis); return <div key={charge.id} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><label htmlFor={`charge-head-${i}`}>{t("Cost head")}</label><select id={`charge-head-${i}`} className={control} value={charge.head} onChange={e => { const head = e.target.value as CostHead; editCharge(i, { head, basis: BASIS_BY_HEAD[head][0], quantity: SENTINEL_BASIS.has(BASIS_BY_HEAD[head][0]) ? "1" : charge.quantity }); }}>{heads.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor={`charge-basis-${i}`}>{t("Basis")}</label><select id={`charge-basis-${i}`} className={control} value={charge.basis} onChange={e => { const basis = e.target.value as JobCostBasis; editCharge(i, { basis, quantity: SENTINEL_BASIS.has(basis) ? "1" : charge.quantity }); }}>{BASIS_BY_HEAD[charge.head].map(value => <option key={value} value={value}>{basisLabel[value]}</option>)}</select></div>
          <div><label htmlFor={`charge-description-${i}`}>{t("Description")}</label><input id={`charge-description-${i}`} className={control} value={charge.description} onChange={e => editCharge(i, { description: e.target.value })} /></div>
          <div><label htmlFor={`charge-quantity-${i}`}>{t("Quantity")}</label><input id={`charge-quantity-${i}`} className={control} inputMode="decimal" disabled={sentinel} value={charge.quantity} onChange={e => editCharge(i, { quantity: e.target.value })} /></div>
          <div><label htmlFor={`charge-rate-${i}`}>{t("Rate (INR)")}</label><input id={`charge-rate-${i}`} className={control} inputMode="decimal" value={charge.rate} onChange={e => editCharge(i, { rate: e.target.value })} /></div>
          <div><label htmlFor={`charge-reason-${i}`}>{t("Reason")}</label><input id={`charge-reason-${i}`} className={control} value={charge.reason} onChange={e => editCharge(i, { reason: e.target.value })} /></div>
          <div><label htmlFor={`charge-evidence-${i}`}>{t("Evidence reference")}</label><input id={`charge-evidence-${i}`} className={control} value={charge.evidenceRef} onChange={e => editCharge(i, { evidenceRef: e.target.value })} /></div>
          <button type="button" className={action} onClick={() => controller.edit({ ...input, charges: input.charges.filter((_, index) => index !== i) })}>{t("Remove charge")}</button>
        </div>; })}
        <button type="button" className={action} onClick={addCharge}>{t("Add charge")}</button>
      </fieldset>

      {preview && <fieldset disabled={blocked} className="space-y-3">
        <legend className="mb-2 font-medium">{t("General PO line classification / allocation")}</legend>
        <p className="text-sm text-muted-foreground">{t("Only Completed, received, within-cap lines are cost-eligible. Committed (unreceived/not yet Completed) and Unavailable (malformed/overreceived) lines are shown for disclosure only and cannot be charged.")}</p>
        <ul className="space-y-3">{preview.generalSources.map(line => {
          const chargeable = line.eligibility === "Eligible" || line.eligibility === "ZeroReceived";
          const d = decisionFor(line.lineId);
          return <li key={line.lineId} className="space-y-2 rounded-lg border p-3 text-sm">
            <p className="break-words">{t("PO")} {line.poId} · {t("Line")} {line.lineId} · {line.status} · {t("Eligibility")}: {line.eligibility}</p>
            <p>{t("Ordered")} {line.orderedQty} {line.uom} / {line.orderedAmount} {t("INR")} · {t("Received")} {line.receivedQty ?? t("Unavailable")} · {t("Eligible cap")} {line.eligibleCap ?? t("Unavailable")}</p>
            {chargeable ? <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label htmlFor={`gen-class-${line.lineId}`}>{t("Classification")}</label><select id={`gen-class-${line.lineId}`} className={control} value={d.classification} onChange={e => { const classification = e.target.value as JobGeneralClassification; setDecision(line.lineId, { classification, allocatedAmount: classification.startsWith("Excluded") ? "0.00" : d.allocatedAmount }); }}>{(Object.keys(classificationLabel) as JobGeneralClassification[]).map(c => <option key={c} value={c}>{classificationLabel[c]}</option>)}</select></div>
              <div><label htmlFor={`gen-amount-${line.lineId}`}>{t("Allocated amount (INR)")}</label><input id={`gen-amount-${line.lineId}`} className={control} inputMode="decimal" disabled={d.classification.startsWith("Excluded")} value={d.allocatedAmount} onChange={e => setDecision(line.lineId, { allocatedAmount: e.target.value })} /></div>
              <div><label htmlFor={`gen-basis-${line.lineId}`}>{t("Basis")}</label><input id={`gen-basis-${line.lineId}`} className={control} value={d.basis} onChange={e => setDecision(line.lineId, { basis: e.target.value })} /></div>
              <div><label htmlFor={`gen-reason-${line.lineId}`}>{t("Reason")}</label><input id={`gen-reason-${line.lineId}`} className={control} value={d.reason} onChange={e => setDecision(line.lineId, { reason: e.target.value })} /></div>
            </div> : <p className="text-muted-foreground">{t("Not cost-eligible: committed or unavailable. No classification accepted for this line.")}</p>}
          </li>;
        })}</ul>
        {!preview.generalSources.length && <p className="text-sm text-muted-foreground">{t("No General PO lines reference this plan.")}</p>}
      </fieldset>}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.preview()}>{t("Preview / recalculate")}</button>
        {!saved && <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.save("create")}>{t("Save draft")}</button>}
        {saved?.status === "Draft" && <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.save("update")}>{t("Update draft / recalculate")}</button>}
        {saved?.status === "Finalized" && <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.save("revision")}>{t("Create new revision (supersede)")}</button>}
      </div>
      {saved?.status === "Draft" && <div className="space-y-2 rounded-lg border border-destructive p-3">
        {!confirmFinalize
          ? <button type="button" className={dangerAction} disabled={blocked || !controller.canFinalize()} onClick={() => setConfirmFinalize(true)}>{t("Finalize saved snapshot")}</button>
          : <div className="space-y-2">
            <p role="alert" className="text-sm">{t("Finalizing is irreversible: this Draft becomes a permanent, immutable valuation. A later correction requires an explicit new revision that supersedes it, not an edit. Confirm?")}</p>
            <div className="flex gap-2">
              <button type="button" className={dangerAction} disabled={blocked || !controller.canFinalize()} onClick={() => { setConfirmFinalize(false); void controller.finalize(); }}>{t("Yes, finalize permanently")}</button>
              <button type="button" className={action} disabled={blocked} onClick={() => setConfirmFinalize(false)}>{t("Cancel")}</button>
            </div>
          </div>}
      </div>}
      {saved && <div className="space-y-2 text-sm">
        <p>{t("Finalization freezes saved rates/evidence, not live evidence. Finalized sheets change only through a new revision.")}</p>
        {!sameSaved && <p role="status">{t("Unsaved inputs / preview differ. Print aur export pichla saved snapshot hi dikhayenge; finalize se pehle draft update karein.")}</p>}
        <div className="flex flex-wrap gap-3">
          <a className="underline" href={`/api/job-cost-sheets/${encodeURIComponent(saved.id)}/export?format=xlsx`}>{t("Export saved snapshot (XLSX)")}</a>
          <a className="underline" href={`/api/job-cost-sheets/${encodeURIComponent(saved.id)}/export?format=csv`}>{t("Export saved snapshot (CSV)")}</a>
          <a className="underline" href={`/job-cost-sheets/${encodeURIComponent(saved.id)}/print`} target="_blank" rel="noopener noreferrer">{t("Print saved snapshot")}</a>
          <button type="button" className={action} disabled={blocked} onClick={() => { setConfirmFinalize(false); controller.load(saved.id); }}>{t("Reload saved snapshot")}</button>
        </div>
      </div>}
    </section>

    {preview && <Snapshot calculation={preview} sheet={sameSaved ? saved! : undefined} />}

    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("Revision history (this plan)")}</h2><button type="button" className={action} disabled={blocked || !input.planId} onClick={() => controller.history()}>{t("Refresh history")}</button></div>
      {!state.history.length && <p className="text-sm text-muted-foreground">{t("No saved sheets loaded for this plan. Refresh history to retry.")}</p>}
      <ul className="space-y-2">{state.history.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <div className="min-w-0 break-words"><p>{s.planId} · {s.productSku} · {t("Revision")} {s.revision} · {s.status === "Draft" ? t("Draft") : t("Finalized")}</p><p>{s.asOfDate} · {t("Full cost (INR)")} {s.fullCost ?? t("Unavailable")} · {t("Can finalize")}: {String(s.canFinalize)}</p></div>
        <div className="flex gap-2">
          <button type="button" className={action} disabled={blocked} onClick={() => { setConfirmFinalize(false); controller.load(s.id); }}>{t("Open saved snapshot")}</button>
          <a className="underline self-center" href={`/job-cost-sheets/${encodeURIComponent(s.id)}/print`} target="_blank" rel="noopener noreferrer">{t("Print")}</a>
        </div>
      </li>)}</ul>
    </section>
  </div>;
}
