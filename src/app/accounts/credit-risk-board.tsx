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
import { ShieldAlert } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type { CreditRiskSummary } from "./types";

/**
 * The per-customer cross-check Receivables Aging's own doc named as its natural next step:
 * Aging (above) shows outstanding by age; Order FMS's Payment_Review gate only checks a
 * customer's credit limit at the moment a NEW order tries to move past it. This surfaces
 * EXISTING risk already on the books — a customer over their own limit, or sitting on
 * anything in the 90+ bucket — even when no new order is asking. Read-only: it takes no
 * action of its own (no auto-hold, no auto-notify), same as Aging itself.
 */
export default function CreditRiskBoard() {
  const t = useT();
  const [summary, setSummary] = useState<CreditRiskSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/accounts/credit-risk")
      .then((res) => res.json())
      .then((data: CreditRiskSummary) => setSummary(data))
      .catch(() => toast.error(t("Credit risk report load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) {
    return <TableSkeleton columns={6} label={t("Load ho raha hai")} />;
  }

  const rows = summary?.rows ?? [];

  return (
    <div className="space-y-4">
      <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        {t(
          "Sirf un customers ki list jinko credit diya gaya hai — Aging ke data se, koi naya calculation nahi. Ye sirf report hai, khud koi hold ya notify nahi karta."
        )}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">{t("Credit Customers")}</div>
          <div className="text-lg font-semibold tabular-nums">{rows.length}</div>
        </div>
        <div className="rounded-lg border-2 border-destructive/40 p-3">
          <div className="text-xs text-muted-foreground">{t("At Risk")}</div>
          <div className="text-lg font-semibold tabular-nums text-destructive">
            {summary?.atRiskCount ?? 0}
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">{t("Total Outstanding")}</div>
          <div className="text-lg font-semibold tabular-nums">₹{summary?.totalOutstanding ?? 0}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert />}
          title={t("Koi bhi customer ko credit nahi diya gaya hai")}
          description={t("Credit Limit set karein Parties me — tabhi ye cross-check kaam karega.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Customer")}</TableHead>
                <TableHead className="text-right">{t("Credit Limit")}</TableHead>
                <TableHead className="text-right">{t("Outstanding")}</TableHead>
                <TableHead className="text-right">{t("90+ Din")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.customerId} className={row.atRisk ? "bg-destructive/5" : undefined}>
                  <TableCell className="font-medium">{row.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{row.creditLimit}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">₹{row.outstanding}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.over90 > 0 ? `₹${row.over90}` : "—"}
                  </TableCell>
                  <TableCell>
                    {row.atRisk ? (
                      <div className="flex flex-wrap gap-1">
                        {row.overLimit && (
                          <Badge variant="destructive">{t("Over Limit")}</Badge>
                        )}
                        {row.hasOverdue90 && (
                          <Badge variant="destructive">{t("90+ Din Purana")}</Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="secondary">{t("Theek Hai")}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
