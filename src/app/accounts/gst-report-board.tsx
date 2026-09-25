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
 * signature, nothing submitted anywhere from here). Only OUTPUT GST (from Issued Sales
 * Invoices) — Input Tax Credit isn't tracked anywhere in this codebase yet, so the summary
 * total is a liability figure, not a net-payable one. Said explicitly in the UI below.
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

  return (
    <div className="space-y-4">
      <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        {t(
          "Ye report aapke CA/accountant ke liye hai — GST portal par filing khud manually honi hai, ye system seedha file nahi karta. Sirf Output GST (jo sales par collect hua) yahan dikhta hai — Input Tax Credit (jo vendors ko GST diya) is system me track nahi hota, isliye ye net-payable figure nahi hai."
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
      ) : lines.length === 0 ? (
        <EmptyState icon={<Receipt />} title={t("Is range me koi Issued invoice nahi hai")} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("Total Taxable Value")}</div>
              <div className="text-lg font-semibold tabular-nums">₹{summary?.totalTaxableValue ?? 0}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("Total Output GST")}</div>
              <div className="text-lg font-semibold tabular-nums">₹{summary?.totalGst ?? 0}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{t("Total Invoice Value")}</div>
              <div className="text-lg font-semibold tabular-nums">₹{summary?.totalInvoiceValue ?? 0}</div>
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
