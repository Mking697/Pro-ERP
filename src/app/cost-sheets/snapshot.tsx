"use client";

import React from "react";
import { useT } from "@/components/preferences-provider";
import type { CostCalculation, CostSheet } from "@/lib/costing/types";

// Calendar-day provenance age in the business timezone, never a valuation calculation.
function sourceAge(sourceDate: string, asOfDate: string): string | null {
  const sourceTime = Date.parse(sourceDate);
  const sheetTime = Date.parse(asOfDate);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(sheetTime)) return null;
  const sourceDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(sourceTime));
  const days = Math.floor((sheetTime - Date.parse(sourceDay)) / 86_400_000);
  return days >= 0 ? String(days) : null;
}

/** Render only server-returned decimal strings: this view never computes a cost. */
export default function Snapshot({ calculation: c, sheet }: { calculation: CostCalculation; sheet?: CostSheet }) {
  const t = useT();
  const money = (value: string | null) => value === null ? t("Unavailable") : value;
  const heads = { Labour: t("Labour"), DirectExpense: t("Direct expenses"), FactoryOverhead: t("Factory overhead"), Commercial: t("Commercial allocations") };
  const bases = { Batch: t("Batch"), PerUnit: t("Per unit"), LabourHours: t("LabourHours"), MachineHours: t("MachineHours") };
  const sources = { Purchase: t("Purchase"), Standard: t("Approved standard rate"), Missing: t("Missing rate") };
  const totals = [
    [t("Known material subtotal (INR)"), c.totals.knownMaterialSubtotal],
    [t("Material total (INR)"), c.totals.material],
    [t("Labour (INR)"), c.totals.labour],
    [t("Direct expenses (INR)"), c.totals.directExpenses],
    [t("Factory overhead (INR)"), c.totals.factoryOverhead],
    [t("Manufacturing total (INR)"), c.totals.manufacturing],
    [t("Commercial allocations (INR)"), c.totals.commercial],
    [t("Full commercial total (INR)"), c.totals.fullCost],
    [t("Full cost per unit (INR)"), c.totals.perUnit],
  ];
  return <section className="min-w-0 space-y-5 rounded-xl border bg-card p-4 print:border-0 print:p-0" aria-label={t("Cost snapshot")}>
    <header className="space-y-2 break-words">
      <h2 className="text-xl font-semibold">{c.productName} — {c.productSku}</h2>
      <p className="text-sm text-muted-foreground">{t("Estimated product cost; actual job cost nahi. Saved snapshots ko hi print aur export kiya jaata hai.")}</p>
      <p>{sheet ? t("Saved snapshot") : t("Unsaved preview")} · {c.complete ? t("Complete") : t("Incomplete")}</p>
      {sheet && <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt>{t("Sheet ID")}</dt><dd>{sheet.id}</dd></div>
        <div><dt>{t("Revision")}</dt><dd>{sheet.revision} · {sheet.status === "Draft" ? t("Draft") : t("Finalized")} · {t("Version")} {sheet.version}</dd></div>
        <div><dt>{t("Created by")}</dt><dd>{sheet.createdBy} · {sheet.createdAt}</dd></div>
        <div><dt>{t("Updated at")}</dt><dd>{sheet.updatedAt}</dd></div>
        {sheet.supersedesId && <div><dt>{t("Supersedes sheet")}</dt><dd>{sheet.supersedesId}</dd></div>}
        {sheet.finalizedAt && <div><dt>{t("Finalized by")}</dt><dd>{sheet.finalizedBy} · {sheet.finalizedAt}</dd></div>}
      </dl>}
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt>{t("BOM / version")}</dt><dd>{c.bomId} / {c.bomVersion}</dd></div>
        <div><dt>{t("Batch quantity")}</dt><dd>{c.input.batchQty} {c.productUom}</dd></div>
        <div><dt>{t("As of date (IST)")}</dt><dd>{c.input.asOfDate}</dd></div>
      </dl>
    </header>
    {!c.complete && <p role="status" className="rounded border border-amber-500 p-3 text-sm">{t("Missing rates ka matlab unavailable hai, zero nahi. Incomplete sheet finalize nahi ho sakti.")}</p>}
    {c.warnings.length > 0 && <ul className="list-inside list-disc text-sm" aria-label={t("Source warnings")}>{c.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-left text-sm [&_td]:border-b [&_td]:p-2 [&_th]:p-2 print:text-xs">
        <caption className="mb-2 text-left font-semibold">{t("Materials and rate provenance")}</caption>
        <thead><tr><th>{t("Material / SKU")}</th><th>{t("UOM")}</th><th>{t("Qty per unit")}</th><th>{t("Required quantity")}</th><th>{t("Rate (INR)")}</th><th>{t("Amount (INR)")}</th><th>{t("Source / date")}</th><th>{t("Source age (days at sheet date)")}</th></tr></thead>
        <tbody>{c.materials.map((m, i) => <tr key={`${m.sku}:${i}`}><td className="break-words">{m.name}<br />{m.sku}</td><td>{m.uom}</td><td>{m.qtyPerUnit}</td><td>{m.requiredQty}</td><td>{money(m.rate)}</td><td>{money(m.amount)}</td><td className="max-w-xs break-words">{sources[m.source.kind]}<br />{m.source.id}<br />{m.source.date}<br />{m.source.description}</td><td>{sourceAge(m.source.date, c.input.asOfDate) ?? t("Unavailable")}</td></tr>)}</tbody>
      </table>
    </div>
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-left text-sm [&_td]:border-b [&_td]:p-2 [&_th]:p-2">
        <caption className="mb-2 text-left font-semibold">{t("Entered charges (INR)")}</caption>
        <thead><tr><th>{t("Cost head")}</th><th>{t("Description")}</th><th>{t("Basis")}</th><th>{t("Applied quantity")}</th><th>{t("Rate (INR)")}</th><th>{t("Amount (INR)")}</th></tr></thead>
        <tbody>{c.charges.map((charge, i) => <tr key={i}><td>{heads[charge.head]}</td><td>{charge.description}</td><td>{bases[charge.basis]}</td><td>{charge.appliedQuantity}</td><td>{charge.rate}</td><td>{charge.amount}</td></tr>)}</tbody>
      </table>
    </div>
    <dl className="ml-auto grid max-w-xl grid-cols-2 gap-3 text-sm">{totals.map(([label, amount]) => <React.Fragment key={label}><dt>{label}</dt><dd className="text-right font-mono">{money(amount)}</dd></React.Fragment>)}</dl>
    <p className="text-xs text-muted-foreground">{t("Recoverable tax excluded. Koi automatic GL posting, inventory revaluation ya payroll allocation nahi.")}</p>
  </section>;
}
