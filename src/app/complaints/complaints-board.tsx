"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { MessageSquareWarning } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import CreateComplaintDialog from "./create-complaint-dialog";
import ComplaintDetailDialog from "./complaint-detail-dialog";
import { COMPLAINT_STATUS_LABEL, type ComplaintRow } from "./types";

export default function ComplaintsBoard({
  currentUserId,
  canWork,
}: {
  currentUserId: string;
  canWork: boolean;
}) {
  const t = useT();
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/complaints", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data: { complaints?: ComplaintRow[] }) => {
        if (!controller.signal.aborted) { setComplaints(data.complaints ?? []); setError(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  return (
    <div className="space-y-4">
      {canWork && (
        <div className="flex justify-end">
          <CreateComplaintDialog onCreated={() => setVersion((v) => v + 1)} />
        </div>
      )}

      {error ? (
        <div role="alert" className="space-y-2 rounded-lg border p-4">
          <p>{t("Task list load nahi ho payi.")}</p>
          <Button variant="outline" onClick={() => { setError(false); setLoading(true); setVersion((v) => v + 1); }}>{t("Retry")}</Button>
        </div>
      ) : loading ? (
        <TableSkeleton columns={5} label={t("Load ho raha hai")} />
      ) : complaints.length === 0 ? (
        <EmptyState
          icon={<MessageSquareWarning />}
          title={t("Abhi koi Complaint nahi hai")}
          description={t("Nayi Complaint register karein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("No.")}</TableHead>
                <TableHead>{t("Customer")}</TableHead>
                <TableHead>{t("Issue")}</TableHead>
                <TableHead>{t("Doer(s)")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {complaints.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                  <TableCell className="font-medium"><Button variant="link" size="sm" aria-label={`${t("View details")}: ${c.displayNo}`} onClick={(event) => { event.stopPropagation(); setOpenId(c.id); }}>{c.displayNo}</Button></TableCell>
                  <TableCell>{c.customerName}</TableCell>
                  <TableCell className="max-w-64 truncate">{c.issueDescription}</TableCell>
                  <TableCell>{c.assignments.map((a) => a.doerName).join(", ") || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "Completed" ? "success" : "secondary"}>
                      {t(COMPLAINT_STATUS_LABEL[c.status])}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ComplaintDetailDialog
        complaintId={openId}
        currentUserId={currentUserId}
        canWork={canWork}
        onOpenChange={(open) => !open && setOpenId(null)}
        onUpdated={() => setVersion((v) => v + 1)}
      />
    </div>
  );
}
