"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import AttachmentLink from "@/components/attachment-link";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import IssueDebitNoteDialog from "./issue-debit-note-dialog";

interface FailureRow {
  Log_ID: string;
  Linked_Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  Invoice_No: string;
  Inward_Type: string;
  Fail_Qty: string;
  Fail_Reason: string;
  Attachment_URL: string;
  Moved_To_Inventory_At: string;
  Debit_Note_ID: string;
  Linked_Vendor_ID: string;
  Deviation_Requested_At: string;
  Deviation_Requested_By: string;
}

interface ImsRow {
  Record_ID: string;
  Linked_Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  Invoice_No: string;
  Inward_Type: string;
  Pass_Qty: string;
}

/**
 * Reads back the two sheets a quality check writes into.
 *
 * Rejections and accepted stock have always been recorded correctly; there was simply
 * no screen for them, so the only way to see what IQC had produced was to open the
 * Google Sheet.
 *
 * `canVerify` (IQC_CHECK) additionally gates the two Failure Log actions this build added:
 * "Accept Under Deviation" (src/lib/inward/deviation.ts — a two-step Request/Approve flow,
 * not a single click; stock only moves once approved) and "Issue Debit Note"
 * (src/lib/accounts/debitNotes.ts, a claim against the vendor) — independent of each other,
 * an entry can get either, both, or neither. `canApproveDeviation` (resolved server-side in
 * page.tsx — the org's configured Deviation Approver, or an Admin) additionally gates the
 * Approve/Reject buttons on a Requested entry.
 */
export default function QualityRecords({
  view,
  canVerify = false,
  canApproveDeviation = false,
}: {
  view: "failures" | "ims";
  canVerify?: boolean;
  canApproveDeviation?: boolean;
}) {
  const t = useT();
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [ims, setIms] = useState<ImsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [debitNoteFor, setDebitNoteFor] = useState<FailureRow | null>(null);
  // debitNoteNo issued THIS session, keyed by Log_ID — a fresh page load only ever knows
  // Debit_Note_ID (the raw row id), never the human-facing number, since fetching that back
  // would need ACCOUNTS_FMS (the Accounts management view's own grant), not IQC_CHECK (who
  // issues it here) — see this component's own header comment.
  const [issuedDebitNoteNos, setIssuedDebitNoteNos] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/inward/records")
      .then((res) => res.json())
      .then((data: { failures?: FailureRow[]; ims?: ImsRow[] }) => {
        setFailures(data.failures ?? []);
        setIms(data.ims ?? []);
      })
      .catch(() => toast.error(t("Records load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function requestDeviation(logId: string) {
    setActingId(logId);
    try {
      const res = await fetch(`/api/inward/failure-log/${logId}/request-deviation`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Request nahi ho payi."));
        return;
      }
      toast.success(t("Under Deviation request bhej di gayi — approval ka wait karein."));
      setFailures((rows) =>
        rows.map((r) => (r.Log_ID === logId ? { ...r, Deviation_Requested_At: new Date().toISOString() } : r))
      );
    } finally {
      setActingId(null);
    }
  }

  async function approveDeviation(logId: string) {
    setActingId(logId);
    try {
      const res = await fetch(`/api/inward/failure-log/${logId}/approve-deviation`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Approve nahi ho paya."));
        return;
      }
      toast.success(t("Stock me add ho gaya."));
      setFailures((rows) =>
        rows.map((r) => (r.Log_ID === logId ? { ...r, Moved_To_Inventory_At: new Date().toISOString() } : r))
      );
    } finally {
      setActingId(null);
    }
  }

  async function rejectDeviation(logId: string) {
    setActingId(logId);
    try {
      const res = await fetch(`/api/inward/failure-log/${logId}/reject-deviation`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Reject nahi ho paya."));
        return;
      }
      toast.success(t("Request reject kar di gayi — dubara request ki ja sakti hai."));
      setFailures((rows) =>
        rows.map((r) => (r.Log_ID === logId ? { ...r, Deviation_Requested_At: "", Deviation_Requested_By: "" } : r))
      );
    } finally {
      setActingId(null);
    }
  }

  if (loading) {
    return <TableSkeleton columns={5} label={t("Records load ho rahe hain")} />;
  }

  if (view === "failures") {
    return (
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Fail Qty</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Attachment</TableHead>
              {canVerify && <TableHead className="w-64">{t("Actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {failures.length === 0 && (
              <TableRow>
                <TableCell colSpan={canVerify ? 8 : 7} className="py-8 text-center text-muted-foreground">{t("Abhi tak koi rejection record nahi hua.")}</TableCell>
              </TableRow>
            )}
            {failures.map((row) => {
              const debitNoteNo = issuedDebitNoteNos[row.Log_ID];
              return (
                <TableRow key={row.Log_ID}>
                  <TableCell className="font-medium">{row.Party_Name}</TableCell>
                  <TableCell>{row.Invoice_No}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.Inward_Type}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-destructive">
                    {row.Fail_Qty}
                  </TableCell>
                  <TableCell className="max-w-xs">{row.Fail_Reason}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDueDisplay(row.Timestamp)}
                  </TableCell>
                  <TableCell>
                    {row.Attachment_URL ? <AttachmentLink url={row.Attachment_URL} /> : "—"}
                  </TableCell>
                  {canVerify && (
                    <TableCell>
                      <div className="flex flex-col items-start gap-1.5">
                        {row.Moved_To_Inventory_At ? (
                          <span className="text-xs text-emerald-700 dark:text-emerald-400">
                            {t("Stock me add ho gaya")}
                          </span>
                        ) : row.Deviation_Requested_At ? (
                          <div className="flex flex-col items-start gap-1.5">
                            <Badge variant="outline">{t("Pending Approval")}</Badge>
                            {canApproveDeviation && (
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={actingId === row.Log_ID}
                                  onClick={() => approveDeviation(row.Log_ID)}
                                >
                                  {t("Approve")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={actingId === row.Log_ID}
                                  onClick={() => rejectDeviation(row.Log_ID)}
                                >
                                  {t("Reject")}
                                </Button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={actingId === row.Log_ID}
                            onClick={() => requestDeviation(row.Log_ID)}
                          >
                            {t("Request Under Deviation")}
                          </Button>
                        )}
                        {row.Debit_Note_ID ? (
                          <span className="text-xs text-muted-foreground">
                            {t("Debit Note issued")}{debitNoteNo ? `: ${debitNoteNo}` : ""}
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => setDebitNoteFor(row)}>
                            {t("Issue Debit Note")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {debitNoteFor && (
          <IssueDebitNoteDialog
            failureLogId={debitNoteFor.Log_ID}
            linkedVendorId={debitNoteFor.Linked_Vendor_ID}
            partyName={debitNoteFor.Party_Name}
            open={Boolean(debitNoteFor)}
            onOpenChange={(open) => {
              if (!open) setDebitNoteFor(null);
            }}
            onCreated={(debitNote) => {
              const logId = debitNoteFor.Log_ID;
              setIssuedDebitNoteNos((m) => ({ ...m, [logId]: debitNote.debitNoteNo }));
              setFailures((rows) =>
                rows.map((r) => (r.Log_ID === logId ? { ...r, Debit_Note_ID: debitNote.id } : r))
              );
              setDebitNoteFor(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Party</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Pass Qty</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ims.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t("Abhi tak koi verified stock record nahi hua.")}</TableCell>
            </TableRow>
          )}
          {ims.map((row) => (
            <TableRow key={row.Record_ID}>
              <TableCell className="font-medium">{row.Party_Name}</TableCell>
              <TableCell>{row.Invoice_No}</TableCell>
              <TableCell>
                <Badge variant="secondary">{row.Inward_Type}</Badge>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                {row.Pass_Qty}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDueDisplay(row.Timestamp)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
