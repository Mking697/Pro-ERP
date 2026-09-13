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
import { formatDueDisplay } from "@/lib/formatDate";
import { parseStamp } from "@/lib/timestamp";
import AttachmentLink from "@/components/attachment-link";
import CreateInwardDialog from "./create-inward-dialog";
import QualityCheckDialog from "./quality-check-dialog";
import type { InwardRecord } from "./types";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

/** An entry's IQC check is only "Not Done" while it's still Pending and past its
 * deadline — a live label, never stored, mirroring isIqcOverdue() in src/lib/inward.ts. */
function isIqcOverdue(entry: InwardRecord): boolean {
  if (entry.IQC_Status !== "Pending" || !entry.IQC_Deadline) return false;
  const deadline = parseStamp(entry.IQC_Deadline);
  return deadline !== null && new Date() > deadline;
}

export default function InwardBoard({ canVerify }: { canVerify: boolean }) {
  const t = useT();
  const [entries, setEntries] = useState<InwardRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inward")
      .then((res) => res.json())
      .then((data: { entries: InwardRecord[] }) => setEntries(data.entries ?? []))
      .catch(() => toast.error(t("Inward entries load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  function handleCreated(entry: InwardRecord) {
    setEntries((prev) => [...prev, entry]);
  }

  function handleVerified(updated: InwardRecord) {
    setEntries((prev) => prev.map((e) => (e.Entry_ID === updated.Entry_ID ? updated : e)));
  }

  if (loading) {
    return <TableSkeleton columns={6} label={t("Inward entries load ho rahi hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateInwardDialog onCreated={handleCreated} />
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              <TableHead>Invoice No.</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>Attachment</TableHead>
              <TableHead>{t("IQC Deadline")}</TableHead>
              <TableHead>Status</TableHead>
              {canVerify && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={canVerify ? 8 : 7} className="text-center text-muted-foreground">{t("Koi inward entry nahi hai.")}</TableCell>
              </TableRow>
            )}
            {entries.map((entry) => (
              <TableRow key={entry.Entry_ID}>
                <TableCell className="font-medium">{entry.Party_Name}</TableCell>
                <TableCell>{entry.Invoice_No}</TableCell>
                <TableCell>{entry.Inward_Type}</TableCell>
                <TableCell>{formatDueDisplay(entry.Timestamp)}</TableCell>
                <TableCell>
                  <AttachmentLink url={entry.Attachment_URL} />
                </TableCell>
                <TableCell>{formatDueDisplay(entry.IQC_Deadline)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      isIqcOverdue(entry)
                        ? "destructive"
                        : entry.IQC_Status === "Verified"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {isIqcOverdue(entry) ? "Not Done" : entry.IQC_Status}
                    {entry.IQC_Status === "Verified" &&
                      Number(entry.IQC_Fail_Qty) > 0 &&
                      " (Fail Qty found)"}
                  </Badge>
                </TableCell>
                {canVerify && (
                  <TableCell className="text-right">
                    {entry.IQC_Status === "Pending" && (
                      <QualityCheckDialog entry={entry} onVerified={handleVerified} />
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
