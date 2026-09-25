"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Download, Receipt } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type { GstReturnSummary } from "./types";

/**
 * A GSTR-1/GSTR-3B-SHAPED report/export for the org's own accountant to manually file on
 * the government GST portal — deliberately NOT e-filing (no GSP/ASP API, no digital
 * signature, nothing submitted anywhere from here). Reports both sides: Output GST (Sales
 * Invoices) and, since 2026-09-25, Input GST (Purchase Bills — Payables' own Input Tax
 * Credit tracking) — Net GST Payable is a real figure now, not just an output-side
 * liability.
 */
export default function GstReportBoard() {
  const t = useT();
  const [summary, setSummary] = useState<GstReturnSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [from, to]);

  useEffect(() => {
    fetch(`/api/accounts/gst-report${query ? `?${query}` : ""}`)
      .then((res) => res.json())
      .then((data: GstReturnSummary) => setSummary(data))
      .catch(() => toast.error(t("GST report load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [query, t]);

  const lines = summary?.lines ?? [];
  const billLines = summary?.billLines ?? [];
  const hasAnything = lines.length > 0 || billLines.length > 0;

  return (
    <div className="space-y-4">
      <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        {t(
          "Ye report aapke CA/accountant ke liye hai — GST portal par filing khud manually honi hai, ye system seedha file nahi karta."
        )}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label>{t("From (optional)")}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t("To (optional)")}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button
          variant="outline"
          render={
            <a href={`/api/accounts/gst-report/csv${query ? `?${query}` : ""}`} download>
              <Download className="mr-1.5 h-4 w-4" />
              {t("CSV Download Karein")}
            </a>
          }
        />
      </div>

      {loading ? (
        <TableSkeleton columns={7} label={t("Load ho raha hai")} />
      ) : !hasAnything ? (
        <EmptyState icon={<Receipt />} title={t("Is range me koi Issued invoice ya bill nahi hai")} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("Total Output GST (Sales)")}</div>
              <div className="text-lg font-semibold tabular-nums">₹{summary?.totalGst ?? 0}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("Total Input GST (Purchase)")}</div>
              <div className="text-lg font-semibold tabular-nums">₹{summary?.totalInputGst ?? 0}</div>
            </div>
            <div className="rounded-lg border-2 border-primary/40 p-3">
              <div className="text-xs text-muted-foreground">{t("Net GST Payable (Output − Input)")}</div>
              <div className="text-lg font-semibold tabular-nums">₹{summary?.netGstPayable ?? 0}</div>
            </div>
          </div>

          {lines.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("Output GST — Sales Invoices")}</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Invoice No.")}</TableHead>
                      <TableHead>{t("Date")}</TableHead>
                      <TableHead>{t("Customer")}</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead className="text-right">{t("Taxable Value")}</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">{t("Invoice Value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.invoiceId}>
                        <TableCell className="font-medium">{line.invoiceNo || line.invoiceId}</TableCell>
                        <TableCell className="text-muted-foreground">{line.invoiceDate.slice(0, 10)}</TableCell>
                        <TableCell>{line.customerName}</TableCell>
                        <TableCell className="text-muted-foreground">{line.customerGstin || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{line.taxableValue}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{line.gstAmount}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">₹{line.invoiceValue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {billLines.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("Input GST — Purchase Bills")}</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Bill No.")}</TableHead>
                      <TableHead>{t("Date")}</TableHead>
                      <TableHead>{t("Vendor")}</TableHead>
                      <TableHead>GSTIN</TableHead>
                      <TableHead className="text-right">{t("Taxable Value")}</TableHead>
                      <TableHead className="text-right">GST</TableHead>
                      <TableHead className="text-right">{t("Bill Value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billLines.map((line) => (
                      <TableRow key={line.billId}>
                        <TableCell className="font-medium">{line.billNo || line.billId}</TableCell>
                        <TableCell className="text-muted-foreground">{line.billDate.slice(0, 10)}</TableCell>
                        <TableCell>{line.vendorName}</TableCell>
                        <TableCell className="text-muted-foreground">{line.vendorGstin || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{line.taxableValue}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{line.gstAmount}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">₹{line.billValue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
