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
import ApplyDebitNoteDialog from "./apply-debit-note-dialog";
import ReceiveDebitNoteDialog from "./receive-debit-note-dialog";
import type { DebitNoteRow } from "./types";

const REASON_LABEL: Record<string, string> = {
  IQC_Fail: "IQC Fail",
  Other: "Other",
};

/** Every Debit Note issued so far, with its own live remaining balance — for one with
 * balance left, "Apply to a Bill" or "Receive Payment" draws it down. Issuing a new Debit
 * Note itself happens from the Failure Log board (see src/app/inward/quality-records.tsx),
 * not from here — this tab is the management/usage view, same split Credit Notes uses
 * between an Invoice's own detail view and its own management tab. */
export default function DebitNotesBoard() {
  const t = useT();
  const [debitNotes, setDebitNotes] = useState<DebitNoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyFor, setApplyFor] = useState<DebitNoteRow | null>(null);
  const [receiveFor, setReceiveFor] = useState<DebitNoteRow | null>(null);

  function load() {
    fetch("/api/accounts/debit-notes")
      .then((res) => res.json())
      .then((data: { debitNotes?: DebitNoteRow[] }) => setDebitNotes(data.debitNotes ?? []))
      .catch(() => toast.error(t("Debit Notes load nahi ho paye.")))
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
      ) : debitNotes.length === 0 ? (
        <EmptyState
          icon={<Undo2 />}
          title={t("Abhi koi Debit Note nahi hai")}
          description={t("Failure Log ke kisi entry se 'Issue Debit Note' se shuru karein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Debit Note No.")}</TableHead>
                <TableHead>{t("Vendor")}</TableHead>
                <TableHead>{t("Reason")}</TableHead>
                <TableHead className="text-right">{t("Amount")}</TableHead>
                <TableHead className="text-right">{t("Balance")}</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {debitNotes.map((dn, i) => (
                <TableRow
                  key={dn.id}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both"
                >
                  <TableCell className="font-medium">{dn.debitNoteNo || dn.id}</TableCell>
                  <TableCell>{dn.vendorName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(REASON_LABEL[dn.reason] ?? (dn.reason || "Other"))}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">₹{dn.amount}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{dn.remainingBalance}</TableCell>
                  <TableCell>
                    {dn.remainingBalance > 0 ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setApplyFor(dn)}>
                          {t("Apply")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setReceiveFor(dn)}>
                          {t("Receive")}
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
        <ApplyDebitNoteDialog
          debitNote={applyFor}
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

      {receiveFor && (
        <ReceiveDebitNoteDialog
          debitNote={receiveFor}
          open={Boolean(receiveFor)}
          onOpenChange={(open) => {
            if (!open) setReceiveFor(null);
          }}
          onReceived={() => {
            setReceiveFor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
