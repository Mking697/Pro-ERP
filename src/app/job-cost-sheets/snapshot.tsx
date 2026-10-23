"use client";

import React from "react";
import { useT } from "@/components/preferences-provider";
import type { JobCostCalculation, JobCostSheet } from "@/lib/job-costing/types";

/** Render-only: every number is a server-returned decimal string, never computed here. */
export default function Snapshot({ calculation: c, sheet }: { calculation: JobCostCalculation; sheet?: JobCostSheet }) {
  const t = useT();
  const money = (value: string | null) => value === null ? t("Unavailable") : value;
  const headLabel: Record<string, string> = { Labour: t("Labour"), DirectExpense: t("Direct expenses"), FactoryOverhead: t("Factory overhead"), Commercial: t("Commercial allocations") };
  const valuationLabel: Record<string, string> = { Missing: t("Missing rate"), PurchaseAgreedProvisional: t("Purchase agreed (provisional)"), ApprovedStandardProvisional: t("Approved standard (provisional)") };
  const totals = [
    [t("Known material subtotal (INR)"), c.totals.knownMaterialSubtotal],
    [t("Material total (INR)"), c.totals.material],
    [t("Labour (INR)"), c.totals.labour],
    [t("Direct expenses (INR)"), c.totals.directExpenses],
    [t("Factory overhead (INR)"), c.totals.factoryOverhead],
    [t("Manufacturing total (INR)"), c.totals.manufacturing],
    [t("Commercial allocations (INR)"), c.totals.commercial],
    [t("Full cost (INR)"), c.totals.fullCost],
    [t("Full cost per good unit (INR)"), c.totals.perGoodUnit],
  ];
  return <section className="min-w-0 space-y-5 rounded-xl border bg-card p-4 print:border-0 print:p-0" aria-label={t("Job cost snapshot")}>
    <header className="space-y-2 break-words">
      <h2 className="text-xl font-semibold">{c.plan.productName} — {c.plan.productSku}</h2>
      <p role="status" className="rounded border border-amber-500 p-3 text-sm">{t("Provisional management valuation only — not proven historical cost, GL posting or stock revaluation. Finalizing freezes a reproducible recorded-basis valuation, not independently measured consumption/output.")}</p>
      <p>{sheet ? t("Saved snapshot") : t("Unsaved preview")} · {c.valuationStatus === "Provisional" ? t("Provisional (finalizable)") : t("Incomplete")}</p>
      {sheet && <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt>{t("Sheet ID")}</dt><dd>{sheet.id}</dd></div>
        <div><dt>{t("Revision")}</dt><dd>{sheet.revision} · {sheet.status === "Draft" ? t("Draft") : t("Finalized")} · {t("Version")} {sheet.version}</dd></div>
        <div><dt>{t("Created by")}</dt><dd>{sheet.createdBy} · {sheet.createdAt}</dd></div>
        <div><dt>{t("Updated at")}</dt><dd>{sheet.updatedAt}</dd></div>
        {sheet.supersedesId && <div><dt>{t("Supersedes sheet")}</dt><dd>{sheet.supersedesId}</dd></div>}
        {sheet.finalizedAt && <div><dt>{t("Finalized by")}</dt><dd>{sheet.finalizedBy} · {sheet.finalizedAt}</dd></div>}
      </dl>}
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div><dt>{t("Plan / Job No")}</dt><dd>{c.plan.planId} / {c.plan.jobNo || t("Unavailable")}</dd></div>
        <div><dt>{t("Plan status")}</dt><dd>{c.plan.status}</dd></div>
        <div><dt>{t("As of date (IST)")}</dt><dd>{c.input.asOfDate}</dd></div>
      </dl>
    </header>
    <section className="space-y-1 rounded border p-3 text-sm">
      <h3 className="font-semibold">{t("Output basis")}</h3>
      <p>{c.output.basis === "CompletionLedger" ? t("Completion ledger") : t("Unavailable")} · {t("Quantity")} {money(c.output.quantity)} {c.output.uom ?? ""} · {c.output.timestamp ?? t("Unavailable")}</p>
      <p className="text-muted-foreground">{c.output.caveat}</p>
    </section>
    {!c.sourceComplete && <p role="status" className="rounded border border-amber-500 p-3 text-sm">{t("Source evidence is incomplete: unreconciled issues/output or unclassified eligible General PO lines block finalization.")}</p>}
    {!c.valuationComplete && <p role="status" className="rounded border border-amber-500 p-3 text-sm">{t("Missing rates/heads ka matlab unavailable hai, zero nahi. Incomplete sheet finalize nahi ho sakti.")}</p>}
    {c.limitations.length > 0 && <ul className="list-inside list-disc text-sm" aria-label={t("Limitations")}>{c.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul>}
    {c.diagnostics.length > 0 && <ul className="list-inside list-disc text-sm" aria-label={t("Diagnostics")}>{c.diagnostics.map((d, i) => <li key={i}>{d.blocking ? t("Blocking") : t("Informational")}: {d.message}</li>)}</ul>}
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-left text-sm [&_td]:border-b [&_td]:p-2 [&_th]:p-2 print:text-xs">
        <caption className="mb-2 text-left font-semibold">{t("Materials and rate provenance")}</caption>
        <thead><tr><th>{t("Material / SKU")}</th><th>{t("UOM")}</th><th>{t("Required qty")}</th><th>{t("Consumed qty")}</th><th>{t("Issued qty")}</th><th>{t("Rate (INR)")}</th><th>{t("Amount (INR)")}</th><th>{t("Valuation / reconciliation")}</th></tr></thead>
        <tbody>{c.materials.map((m, i) => <tr key={`${m.sku}:${i}`}><td className="break-words">{m.name}<br />{m.sku}</td><td>{m.uom}</td><td>{m.requiredQty}</td><td>{m.consumedQty}</td><td>{money(m.issuedQuantity)}</td><td>{money("rate" in m.valuation ? m.valuation.rate : null)}</td><td>{money(m.amount)}</td><td className="max-w-xs break-words">{valuationLabel[m.valuation.kind]} · {m.reconciliation}</td></tr>)}</tbody>
      </table>
    </div>
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-left text-sm [&_td]:border-b [&_td]:p-2 [&_th]:p-2">
        <caption className="mb-2 text-left font-semibold">{t("General PO expense sources — committed vs received")}</caption>
        <thead><tr><th>{t("PO / Line")}</th><th>{t("Status")}</th><th>{t("Ordered / received")}</th><th>{t("Eligibility")}</th><th>{t("Eligible cap")}</th><th>{t("Classification")}</th><th>{t("Allocated (INR)")}</th></tr></thead>
        <tbody>{c.generalSources.map((g, i) => <tr key={`${g.lineId}:${i}`}><td className="break-words">{g.poId}<br />{g.lineId}</td><td>{g.status}</td><td>{g.orderedQty} {g.uom} / {g.receivedQty ?? t("Unavailable")}</td><td>{g.eligibility}</td><td>{money(g.eligibleCap)}</td><td>{g.decision?.classification ?? t("Undecided")}</td><td>{money(g.allocatedAmount)}</td></tr>)}</tbody>
      </table>
    </div>
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-left text-sm [&_td]:border-b [&_td]:p-2 [&_th]:p-2">
        <caption className="mb-2 text-left font-semibold">{t("Approved charges (INR)")}</caption>
        <thead><tr><th>{t("Cost head")}</th><th>{t("Description")}</th><th>{t("Basis")}</th><th>{t("Applied quantity")}</th><th>{t("Rate (INR)")}</th><th>{t("Amount (INR)")}</th></tr></thead>
        <tbody>{c.charges.map((charge, i) => <tr key={i}><td>{headLabel[charge.head] ?? charge.head}</td><td>{charge.description}</td><td>{charge.basis}</td><td>{money(charge.appliedQuantity)}</td><td>{charge.rate}</td><td>{money(charge.amount)}</td></tr>)}</tbody>
      </table>
    </div>
    <dl className="ml-auto grid max-w-xl grid-cols-2 gap-3 text-sm">{totals.map(([label, amount]) => <React.Fragment key={label}><dt>{label}</dt><dd className="text-right font-mono">{money(amount)}</dd></React.Fragment>)}</dl>
    <p className="text-xs text-muted-foreground">{t("Recoverable tax excluded. Koi automatic GL posting, inventory revaluation ya payroll allocation nahi.")}</p>
  </section>;
}
