"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import {
  computeTotals,
  evaluateFormula,
  FormulaError,
  lineAmount,
  looksLikeFormula,
} from "@/lib/leads/quotationMath";
import type { QuotationRow } from "../../types";

interface GridRow {
  key: string;
  particular: string;
  specification: string;
  description: string;
  uom: string;
  qtyText: string;
  qty: number;
  qtyFormula: string;
  rate: string;
}

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `row-${keySeq}`;
}

function emptyRow(): GridRow {
  return {
    key: newKey(),
    particular: "",
    specification: "",
    description: "",
    uom: "",
    qtyText: "",
    qty: 0,
    qtyFormula: "",
    rate: "",
  };
}

function rowFromQuotationItem(item: QuotationRow["items"][number]): GridRow {
  return {
    key: newKey(),
    particular: item.particular,
    specification: item.specification,
    description: item.description,
    uom: item.uom,
    qtyText: item.qtyFormula || String(item.qty),
    qty: item.qty,
    qtyFormula: item.qtyFormula,
    rate: item.rate ? String(item.rate) : "",
  };
}

function resolveQty(text: string): { qty: number; qtyFormula: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return { qty: 0, qtyFormula: "" };
  if (!looksLikeFormula(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return null;
    return { qty: n, qtyFormula: "" };
  }
  try {
    return { qty: evaluateFormula(trimmed), qtyFormula: trimmed };
  } catch (err) {
    if (err instanceof FormulaError) return null;
    return null;
  }
}

export default function QuotationBuilder({ quotationId }: { quotationId: string }) {
  const t = useT();
  const [quotation, setQuotation] = useState<QuotationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [header, setHeader] = useState<Partial<QuotationRow>>({});
  const [rows, setRows] = useState<GridRow[]>([]);
  const [freightAmount, setFreightAmount] = useState("0");
  const [gstPercent, setGstPercent] = useState("18");

  function load() {
    fetch(`/api/leads/quotations/${quotationId}`)
      .then((res) => res.json())
      .then((data: { quotation?: QuotationRow }) => {
        if (!data.quotation) return;
        setQuotation(data.quotation);
        setHeader(data.quotation);
        setRows(data.quotation.items.length > 0 ? data.quotation.items.map(rowFromQuotationItem) : [emptyRow()]);
        setFreightAmount(String(data.quotation.freightAmount));
        setGstPercent(String(data.quotation.gstPercent));
      })
      .catch(() => toast.error(t("Quotation load nahi ho paya.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationId]);

  const preview = useMemo(() => {
    const lines = rows.map((r) => ({ amount: lineAmount(r.qty, Number(r.rate) || 0) }));
    return computeTotals(lines, Number(freightAmount) || 0, Number(gstPercent) || 0);
  }, [rows, freightAmount, gstPercent]);

  function updateRow(key: string, patch: Partial<GridRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function commitQty(key: string, text: string) {
    const resolved = resolveQty(text);
    if (!resolved) {
      toast.error(t("Ye quantity samajh nahi aayi — sirf number ya formula (+ - * / ( )) likhein."));
      return;
    }
    updateRow(key, { qtyText: text, qty: resolved.qty, qtyFormula: resolved.qtyFormula });
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  const isAccepted = quotation?.status === "Accepted";

  async function saveHeader(): Promise<boolean> {
    const res = await fetch(`/api/leads/quotations/${quotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "header",
        partyName: header.partyName,
        contactPerson: header.contactPerson,
        customerMobile: header.customerMobile,
        customerEmail: header.customerEmail,
        customerGst: header.customerGst,
        billingAddress: header.billingAddress,
        billingCity: header.billingCity,
        billingState: header.billingState,
        billingPincode: header.billingPincode,
        shippingPartyName: header.shippingPartyName,
        shippingContactPerson: header.shippingContactPerson,
        shippingAddress: header.shippingAddress,
        shippingCity: header.shippingCity,
        shippingState: header.shippingState,
        shippingPincode: header.shippingPincode,
        subject: header.subject,
        note: header.note,
        terms: header.terms,
        validUntil: header.validUntil ? header.validUntil.slice(0, 10) : "",
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(t(data?.error ?? "Header save nahi hua."));
      return false;
    }
    return true;
  }

  async function saveItems(): Promise<boolean> {
    const res = await fetch(`/api/leads/quotations/${quotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "items",
        items: rows
          .filter((r) => r.particular.trim() || r.description.trim() || r.qty || Number(r.rate))
          .map((r) => ({
            particular: r.particular,
            specification: r.specification,
            description: r.description,
            uom: r.uom,
            qtyFormula: r.qtyFormula,
            qty: r.qty,
            rate: Number(r.rate) || 0,
          })),
        freightAmount: Number(freightAmount) || 0,
        gstPercent: Number(gstPercent) || 0,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(t(data?.error ?? "Items save nahi hue."));
      return false;
    }
    setQuotation(data.quotation);
    return true;
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      const headerOk = await saveHeader();
      if (!headerOk) return;
      const itemsOk = await saveItems();
      if (!itemsOk) return;
      toast.success(t("Draft save ho gaya."));
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(action: "send" | "accept" | "reject") {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/quotations/${quotationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Update nahi ho paya."));
        return;
      }
      setQuotation(data.quotation);
      toast.success(t("Ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadPdf() {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/quotations/${quotationId}/pdf`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "PDF nahi ban paya."));
        return;
      }
      window.open(data.url, "_blank");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !quotation) {
    return <FormSkeleton fields={6} label={t("Quotation load ho raha hai")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">{quotation.quotationNo}</span>
          <Badge variant={quotation.status === "Accepted" ? "default" : "secondary"}>
            {quotation.status}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={saving} onClick={handleDownloadPdf}>
            PDF Download
          </Button>
          {!isAccepted && (
            <Button size="sm" variant="outline" disabled={saving} onClick={handleSaveDraft}>
              {t("Draft Save Karein")}
            </Button>
          )}
          {quotation.status === "Draft" && (
            <Button size="sm" disabled={saving} onClick={() => handleAction("send")}>
              {t("Bhej Dein (Send)")}
            </Button>
          )}
          {quotation.status === "Sent" && (
            <>
              <Button size="sm" disabled={saving} onClick={() => handleAction("accept")}>
                {t("Accepted Mark Karein")}
              </Button>
              <Button size="sm" variant="outline" className="text-destructive" disabled={saving} onClick={() => handleAction("reject")}>
                {t("Rejected Mark Karein")}
              </Button>
            </>
          )}
        </div>
      </div>

      {isAccepted && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          {t("Ye quotation Accept ho chuka hai — ab edit nahi ho sakta, sirf PDF dobara download ho sakta hai.")}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Party Details</p>
          <div className="space-y-2">
            <Label>Party Name</Label>
            <Input
              disabled={isAccepted}
              value={header.partyName ?? ""}
              onChange={(e) => setHeader((h) => ({ ...h, partyName: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Contact Person")}</Label>
              <Input
                disabled={isAccepted}
                value={header.contactPerson ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, contactPerson: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Mobile</Label>
              <Input
                disabled={isAccepted}
                value={header.customerMobile ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, customerMobile: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                disabled={isAccepted}
                value={header.customerEmail ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, customerEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>GST</Label>
              <Input
                disabled={isAccepted}
                value={header.customerGst ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, customerGst: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Billing Address</Label>
            <Textarea
              rows={2}
              disabled={isAccepted}
              value={header.billingAddress ?? ""}
              onChange={(e) => setHeader((h) => ({ ...h, billingAddress: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>{t("City")}</Label>
              <Input
                disabled={isAccepted}
                value={header.billingCity ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, billingCity: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("State")}</Label>
              <Input
                disabled={isAccepted}
                value={header.billingState ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, billingState: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Pincode</Label>
              <Input
                disabled={isAccepted}
                value={header.billingPincode ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, billingPincode: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Delivery Address <span className="text-xs text-muted-foreground">({t("khaali chhodein agar billing jaisa hi hai")})</span></p>
          <div className="space-y-2">
            <Label>Party Name</Label>
            <Input
              disabled={isAccepted}
              value={header.shippingPartyName ?? ""}
              onChange={(e) => setHeader((h) => ({ ...h, shippingPartyName: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Contact Person")}</Label>
            <Input
              disabled={isAccepted}
              value={header.shippingContactPerson ?? ""}
              onChange={(e) => setHeader((h) => ({ ...h, shippingContactPerson: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea
              rows={2}
              disabled={isAccepted}
              value={header.shippingAddress ?? ""}
              onChange={(e) => setHeader((h) => ({ ...h, shippingAddress: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>{t("City")}</Label>
              <Input
                disabled={isAccepted}
                value={header.shippingCity ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, shippingCity: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("State")}</Label>
              <Input
                disabled={isAccepted}
                value={header.shippingState ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, shippingState: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Pincode</Label>
              <Input
                disabled={isAccepted}
                value={header.shippingPincode ?? ""}
                onChange={(e) => setHeader((h) => ({ ...h, shippingPincode: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Subject</Label>
          <Input
            disabled={isAccepted}
            value={header.subject ?? ""}
            onChange={(e) => setHeader((h) => ({ ...h, subject: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Valid Until</Label>
          <Input
            type="date"
            disabled={isAccepted}
            value={header.validUntil ? header.validUntil.slice(0, 10) : ""}
            onChange={(e) => setHeader((h) => ({ ...h, validUntil: e.target.value }))}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Line Items</p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Particular</TableHead>
                <TableHead>Specification</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-20">UOM</TableHead>
                <TableHead className="w-32">Qty / Formula</TableHead>
                <TableHead className="w-28 text-right">Rate</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.key}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell>
                    <Input
                      disabled={isAccepted}
                      className="h-8"
                      value={row.particular}
                      onChange={(e) => updateRow(row.key, { particular: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      disabled={isAccepted}
                      className="h-8"
                      value={row.specification}
                      onChange={(e) => updateRow(row.key, { specification: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      disabled={isAccepted}
                      className="h-8"
                      value={row.description}
                      onChange={(e) => updateRow(row.key, { description: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      disabled={isAccepted}
                      className="h-8 w-16"
                      value={row.uom}
                      onChange={(e) => updateRow(row.key, { uom: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      disabled={isAccepted}
                      className="h-8"
                      placeholder="2.5*3+1"
                      value={row.qtyText}
                      onChange={(e) => updateRow(row.key, { qtyText: e.target.value })}
                      onBlur={(e) => commitQty(row.key, e.target.value)}
                      title={row.qtyFormula ? `= ${row.qty}` : undefined}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      disabled={isAccepted}
                      type="number"
                      step="any"
                      min="0"
                      className="h-8 text-right tabular-nums"
                      value={row.rate}
                      onChange={(e) => updateRow(row.key, { rate: e.target.value })}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {lineAmount(row.qty, Number(row.rate) || 0).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {!isAccepted && rows.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeRow(row.key)}>
                        ×
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!isAccepted && (
          <Button variant="outline" size="sm" className="mt-2" onClick={addRow}>
            {t("+ Line Add Karein")}
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Note</p>
          <Textarea
            rows={2}
            disabled={isAccepted}
            value={header.note ?? ""}
            onChange={(e) => setHeader((h) => ({ ...h, note: e.target.value }))}
          />
          <p className="text-sm font-medium">Terms &amp; Conditions</p>
          <Textarea
            rows={4}
            disabled={isAccepted}
            value={header.terms ?? ""}
            onChange={(e) => setHeader((h) => ({ ...h, terms: e.target.value }))}
          />
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Totals</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Freight</Label>
              <Input
                disabled={isAccepted}
                type="number"
                step="any"
                min="0"
                value={freightAmount}
                onChange={(e) => setFreightAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>GST %</Label>
              <Input
                disabled={isAccepted}
                type="number"
                step="any"
                min="0"
                max="100"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
              />
            </div>
          </div>
          <Separator className="my-2" />
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Sub Total</span>
              <span className="tabular-nums">{preview.subTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Freight</span>
              <span className="tabular-nums">{preview.freight.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>
                GST {preview.gstPercent}% (on {preview.gstBase.toFixed(2)})
              </span>
              <span className="tabular-nums">{preview.gst.toFixed(2)}</span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between text-base font-semibold">
              <span>Payable</span>
              <span className="tabular-nums">{preview.payable.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
