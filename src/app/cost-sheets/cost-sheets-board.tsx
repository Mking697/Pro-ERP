"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/preferences-provider";
import { CostSheetController, costDataEqual } from "@/lib/costing/client";
import type { CostBasis, CostChargeInput, CostHead, StandardCostRateInput } from "@/lib/costing/types";
import Snapshot from "./snapshot";

const control = "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60";
const action = "rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

export default function CostSheetsBoard({ initialProductSku, initialDate }: { initialProductSku: string; initialDate: string }) {
  const t = useT();
  const [controller] = useState(() => new CostSheetController({ productSku: initialProductSku, batchQty: "1", asOfDate: initialDate, charges: [] }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [rate, setRate] = useState<StandardCostRateInput>({ sku: "", uom: "", rate: "", effectiveDate: initialDate, reason: "" });
  const { input, saved, preview } = state;
  const blocked = state.busy || !!state.pending || !!state.advanced || state.reading;
  const product = state.products.find(p => p.sku === input.productSku);
  const missingBom = !!product && !product.bomId;
  const ready = !!input.productSku && !!input.batchQty && !!input.asOfDate && !missingBom;
  const sameSaved = !!saved && costDataEqual(input, saved.calculation.input) && costDataEqual(preview, saved.calculation);
  const canApprove = !!preview?.materials.some(m => m.sku === rate.sku && m.uom === rate.uom) && !!rate.rate && !!rate.reason.trim() && !!rate.effectiveDate;
  const heads: [CostHead, string][] = [["Labour", t("Labour")], ["DirectExpense", t("Direct expenses")], ["FactoryOverhead", t("Factory overhead")], ["Commercial", t("Commercial allocations")]];
  const bases: [CostBasis, string][] = [["Batch", t("Batch")], ["PerUnit", t("Per unit")], ["LabourHours", t("LabourHours")], ["MachineHours", t("MachineHours")]];
  useEffect(() => { controller.activate(); void controller.catalog(); return () => controller.dispose(); }, [controller]);
  useEffect(() => { if (input.productSku) void controller.history(); }, [controller, input.productSku, saved?.id, saved?.version]);
  const editCharge = (index: number, patch: Partial<CostChargeInput>) => controller.edit({ ...input, charges: input.charges.map((charge, i) => i === index ? { ...charge, ...patch } : charge) });

  return <div className="min-w-0 space-y-6" aria-busy={state.busy || state.reading}>
    {state.error && <p role="alert" className="break-words rounded-md border border-destructive p-3 text-sm">{state.error}</p>}
    {state.notice === "saved" && <p role="status">{t("Saved snapshot readback verified.")}</p>}
    {state.notice === "approved" && <p role="status">{t("Rate approved. Preview aur draft update explicitly karein; saved snapshot abhi nahi badla.")}</p>}
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
      <h2 className="text-lg font-semibold">{t("Estimate inputs")}</h2>
      <p className="text-sm text-muted-foreground">{t("Purchase agreed rate pehle, phir approved standard rate. Generic Item Rate purchasing rate nahi hai.")}</p>
      <fieldset disabled={blocked} className="grid min-w-0 gap-4 sm:grid-cols-3">
        <div><label htmlFor="cost-product" className="mb-1 block text-sm">{t("Product / SKU")}</label>
          <select id="cost-product" className={control} value={input.productSku} onChange={e => { if (controller.edit({ ...input, productSku: e.target.value })) setRate({ sku: "", uom: "", rate: "", effectiveDate: input.asOfDate, reason: "" }); }}>
            <option value="">{t("Select product")}</option>
            {input.productSku && !product && <option value={input.productSku}>{input.productSku}</option>}
            {state.products.map(p => <option key={p.sku} value={p.sku}>{p.name} · {p.sku} · {p.uom}</option>)}
          </select>
        </div>
        <div><label htmlFor="cost-batch" className="mb-1 block text-sm">{t("Batch quantity")}</label><input id="cost-batch" className={control} inputMode="decimal" value={input.batchQty} onChange={e => controller.edit({ ...input, batchQty: e.target.value })} /></div>
        <div><label htmlFor="cost-date" className="mb-1 block text-sm">{t("As of date (IST)")}</label><input id="cost-date" className={control} type="date" value={input.asOfDate} onChange={e => controller.edit({ ...input, asOfDate: e.target.value })} /></div>
      </fieldset>
      {missingBom && <p role="status">{t("Is product ka active BOM nahi hai. Preview aur save unavailable hain.")}</p>}
      <button type="button" className={action} disabled={blocked} onClick={() => controller.catalog()}>{t("Refresh products")}</button>
      <fieldset disabled={blocked} className="space-y-4">
        <legend className="mb-2 font-medium">{t("Cost charges")}</legend>
        <p className="text-sm text-muted-foreground">{t("Batch basis 1 use karta hai; Per unit batch quantity use karta hai. Hours ke liye explicit quantity dein. Sirf nonrecoverable charges enter karein.")}</p>
        {input.charges.map((charge, i) => <div key={i} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><label htmlFor={`charge-head-${i}`}>{t("Cost head")}</label><select id={`charge-head-${i}`} className={control} value={charge.head} onChange={e => editCharge(i, { head: e.target.value as CostHead })}>{heads.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor={`charge-description-${i}`}>{t("Description")}</label><input id={`charge-description-${i}`} className={control} value={charge.description} onChange={e => editCharge(i, { description: e.target.value })} /></div>
          <div><label htmlFor={`charge-basis-${i}`}>{t("Basis")}</label><select id={`charge-basis-${i}`} className={control} value={charge.basis} onChange={e => editCharge(i, { basis: e.target.value as CostBasis })}>{bases.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div><label htmlFor={`charge-quantity-${i}`}>{t("Hours quantity")}</label><input id={`charge-quantity-${i}`} className={control} inputMode="decimal" value={charge.quantity} disabled={charge.basis !== "LabourHours" && charge.basis !== "MachineHours"} onChange={e => editCharge(i, { quantity: e.target.value })} /></div>
          <div><label htmlFor={`charge-rate-${i}`}>{t("Rate (INR)")}</label><input id={`charge-rate-${i}`} className={control} inputMode="decimal" value={charge.rate} onChange={e => editCharge(i, { rate: e.target.value })} /></div>
          <button type="button" className={action} onClick={() => controller.edit({ ...input, charges: input.charges.filter((_, index) => index !== i) })}>{t("Remove charge")}</button>
        </div>)}
        <button type="button" className={action} onClick={() => controller.edit({ ...input, charges: [...input.charges, { head: "Labour", description: "", basis: "Batch", quantity: "1", rate: "" }] })}>{t("Add charge")}</button>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.preview()}>{t("Preview / recalculate")}</button>
        {!saved && <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.save("create")}>{t("Save draft")}</button>}
        {saved?.status === "Draft" && <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.save("update")}>{t("Update draft / recalculate")}</button>}
        {saved?.status === "Finalized" && <button type="button" className={action} disabled={blocked || !ready} onClick={() => controller.save("revision")}>{t("Create new revision")}</button>}
        {saved?.status === "Draft" && <button type="button" className={action} disabled={blocked || !controller.canFinalize()} onClick={() => controller.finalize()}>{t("Finalize saved snapshot")}</button>}
      </div>
      {saved && <div className="space-y-2 text-sm">
        <p>{t("Finalization freezes saved rates, not live rates. Finalized sheets change only through a new revision.")}</p>
        {!sameSaved && <p role="status">{t("Unsaved inputs / preview differ. Print aur export pichla saved snapshot hi dikhayenge; finalize se pehle draft update karein.")}</p>}
        <div className="flex flex-wrap gap-3">
          <a className="underline" href={`/api/cost-sheets/${encodeURIComponent(saved.id)}/export`}>{t("Export saved snapshot (XLSX)")}</a>
          <a className="underline" href={`/cost-sheets/${encodeURIComponent(saved.id)}/print`} target="_blank" rel="noopener noreferrer">{t("Print saved snapshot")}</a>
          <button type="button" className={action} disabled={blocked} onClick={() => controller.load(saved.id)}>{t("Reload saved snapshot")}</button>
        </div>
      </div>}
    </section>
    {preview && <Snapshot calculation={preview} sheet={sameSaved ? saved! : undefined} />}
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{t("Approve standard costing rate")}</h2>
      <p className="text-sm text-muted-foreground">{t("Preview material select karein. Approval effective-dated aur audited hai; purane finalized snapshots nahi badalte. Explicit zero allowed hai, blank missing hai.")}</p>
      <form onSubmit={e => { e.preventDefault(); if (!blocked && canApprove) void controller.approve(rate); }}>
        <fieldset disabled={blocked} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><label htmlFor="standard-material">{t("Material / SKU")}</label><select id="standard-material" className={control} value={rate.sku} required onChange={e => { const material = preview?.materials.find(m => m.sku === e.target.value); setRate({ ...rate, sku: material?.sku ?? "", uom: material?.uom ?? "" }); }}><option value="">{t("Select preview material")}</option>{preview?.materials.map((m, i) => <option key={`${m.sku}:${i}`} value={m.sku}>{m.name} · {m.sku} · {m.uom}</option>)}</select></div>
          <div><label htmlFor="standard-uom">{t("UOM")}</label><input id="standard-uom" className={control} value={rate.uom} readOnly /></div>
          <div><label htmlFor="standard-rate">{t("Rate (INR)")}</label><input id="standard-rate" className={control} value={rate.rate} inputMode="decimal" required onChange={e => setRate({ ...rate, rate: e.target.value })} /></div>
          <div><label htmlFor="standard-date">{t("Effective date")}</label><input id="standard-date" className={control} type="date" value={rate.effectiveDate} required onChange={e => setRate({ ...rate, effectiveDate: e.target.value })} /></div>
          <div><label htmlFor="standard-reason">{t("Approval reason")}</label><input id="standard-reason" className={control} value={rate.reason} required onChange={e => setRate({ ...rate, reason: e.target.value })} /></div>
          <button type="submit" className={action} disabled={!canApprove}>{t("Approve rate")}</button>
        </fieldset>
      </form>
    </section>
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{t("Saved revision history")}</h2><button type="button" className={action} disabled={blocked || !input.productSku} onClick={() => controller.history()}>{t("Refresh history")}</button></div>
      {!state.history.length && <p className="text-sm text-muted-foreground">{t("No saved sheets loaded for this product. Refresh history to retry.")}</p>}
      <ul className="space-y-2">{state.history.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
        <div className="min-w-0 break-words"><p>{s.productName} · {s.productSku} · {t("Revision")} {s.revision} · {s.status === "Draft" ? t("Draft") : t("Finalized")}</p><p>{s.asOfDate} · {t("Batch quantity")} {s.batchQty} · {t("Full commercial total (INR)")} {s.totalCost ?? t("Unavailable")}</p></div>
        <button type="button" className={action} disabled={blocked} onClick={() => controller.load(s.id)}>{t("Open saved snapshot")}</button>
      </li>)}</ul>
    </section>
  </div>;
}
