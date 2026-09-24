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
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Undo2 } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import ApplyCreditNoteDialog from "./apply-credit-note-dialog";
import RefundCreditNoteDialog from "./refund-credit-note-dialog";
import type { CreditNoteRow } from "./types";

const REASON_LABEL: Record<string, string> = {
  Sales_Return: "Sales Return",
  Transit_Loss: "Transit Loss",
  Price_Adjustment: "Price Adjustment",
  Other: "Other",
};

/** Every Credit Note issued so far, with its own live remaining balance — for one with
 * balance left, "Apply to an Order" or "Refund" draws it down. Issuing a new Credit Note
 * itself happens from an Issued Invoice's own detail view (see invoice-detail-dialog.tsx),
 * not from here — this tab is the management/usage view. */
export default function CreditNotesBoard() {
  const t = useT();
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyFor, setApplyFor] = useState<CreditNoteRow | null>(null);
  const [refundFor, setRefundFor] = useState<CreditNoteRow | null>(null);

  function load() {
    fetch("/api/accounts/credit-notes")
      .then((res) => res.json())
      .then((data: { creditNotes?: CreditNoteRow[] }) => setCreditNotes(data.creditNotes ?? []))
      .catch(() => toast.error(t("Credit Notes load nahi ho paye.")))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    setLoading(true);
    load();
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <TableSkeleton columns={7} label={t("Load ho raha hai")} />
      ) : creditNotes.length === 0 ? (
        <EmptyState
          icon={<Undo2 />}
          title={t("Abhi koi Credit Note nahi hai")}
          description={t("Ek Issued Invoice ke detail me se 'Credit Note Issue Karein' se shuru karein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Credit Note No.")}</TableHead>
                <TableHead>{t("Customer")}</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>{t("Reason")}</TableHead>
                <TableHead className="text-right">{t("Amount")}</TableHead>
                <TableHead className="text-right">{t("Balance")}</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditNotes.map((cn, i) => (
                <TableRow
                  key={cn.id}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both"
                >
                  <TableCell className="font-medium">{cn.creditNoteNo || cn.id}</TableCell>
                  <TableCell>{cn.customerName || "—"}</TableCell>
                  <TableCell>{cn.invoiceId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(REASON_LABEL[cn.reason] ?? (cn.reason || "Other"))}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">₹{cn.amount}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{cn.remainingBalance}</TableCell>
                  <TableCell>
                    {cn.remainingBalance > 0 ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setApplyFor(cn)}>
                          {t("Apply")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRefundFor(cn)}>
                          {t("Refund")}
                        </Button>
                      </div>
                    ) : (
                      <span className="block text-right text-xs text-muted-foreground">{t("Poora use ho gaya")}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {applyFor && (
        <ApplyCreditNoteDialog
          creditNote={applyFor}
          open={Boolean(applyFor)}
          onOpenChange={(open) => {
            if (!open) setApplyFor(null);
          }}
          onApplied={() => {
            setApplyFor(null);
            refresh();
          }}
        />
      )}

      {refundFor && (
        <RefundCreditNoteDialog
          creditNote={refundFor}
          open={Boolean(refundFor)}
          onOpenChange={(open) => {
            if (!open) setRefundFor(null);
          }}
          onRefunded={() => {
            setRefundFor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
