"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Clock } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type { AgingBucket, AgingSummary } from "./types";

const BUCKETS: AgingBucket[] = ["0-30", "31-60", "61-90", "90+"];

const BUCKET_VARIANT: Record<AgingBucket, "secondary" | "outline" | "destructive"> = {
  "0-30": "secondary",
  "31-60": "outline",
  "61-90": "outline",
  "90+": "destructive",
};

/**
 * Ages at the ORDER level, not per-invoice — an order can carry several invoices (multi-
 * invoice split) and order_payments isn't attributed to any one of them, so there's no
 * clean way to age a specific invoice's own outstanding balance. See accounts.ts's own
 * getReceivablesAging() comment for the full reasoning.
 */
export default function AgingBoard() {
  const t = useT();
  const [summary, setSummary] = useState<AgingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/accounts/aging")
      .then((res) => res.json())
      .then((data: AgingSummary) => setSummary(data))
      .catch(() => toast.error(t("Aging report load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) {
    return <TableSkeleton columns={5} label={t("Load ho raha hai")} />;
  }

  const rows = summary?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BUCKETS.map((bucket) => (
          <div key={bucket} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{bucket} {t("din")}</div>
            <div className="text-lg font-semibold tabular-nums">
              ₹{summary?.bucketTotals[bucket] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title={t("Koi outstanding receivable nahi hai")}
          description={t("Har Issued invoice ka poora payment aa chuka hai.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Order")}</TableHead>
                <TableHead>{t("Customer")}</TableHead>
                <TableHead>{t("Pehla Invoice")}</TableHead>
                <TableHead className="text-right">{t("Din")}</TableHead>
                <TableHead>{t("Bucket")}</TableHead>
                <TableHead className="text-right">{t("Outstanding")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.orderId}>
                  <TableCell className="font-medium">{row.orderId}</TableCell>
                  <TableCell>{row.partyName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.earliestInvoiceDate.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.daysOutstanding}</TableCell>
                  <TableCell>
                    <Badge variant={BUCKET_VARIANT[row.bucket]}>{row.bucket} {t("din")}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    ₹{row.outstanding}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {summary && rows.length > 0 && (
        <p className="text-right text-sm text-muted-foreground">
          {t("Total Outstanding")}: <span className="font-semibold text-foreground">₹{summary.grandTotal}</span>
        </p>
      )}
    </div>
  );
}
