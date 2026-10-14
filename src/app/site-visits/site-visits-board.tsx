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
import { MapPinned } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import CreateSiteVisitDialog from "./create-site-visit-dialog";
import SiteVisitDetailDialog from "./site-visit-detail-dialog";
import { SITE_VISIT_STATUS_LABEL, VISIT_FOR_LABEL, type SiteVisitRow } from "./types";

export default function SiteVisitsBoard({
  currentUserId,
  canWork,
}: {
  currentUserId: string;
  canWork: boolean;
}) {
  const t = useT();
  const [visits, setVisits] = useState<SiteVisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/site-visits", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data: { visits?: SiteVisitRow[] }) => {
        if (!controller.signal.aborted) { setVisits(data.visits ?? []); setError(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  return (
    <div className="space-y-4">
      {canWork && (
        <div className="flex justify-end">
          <CreateSiteVisitDialog onCreated={() => setVersion((v) => v + 1)} />
        </div>
      )}

      {error ? (
        <div role="alert" className="space-y-2 rounded-lg border p-4">
          <p>{t("Task list load nahi ho payi.")}</p>
          <Button variant="outline" onClick={() => { setError(false); setLoading(true); setVersion((v) => v + 1); }}>{t("Retry")}</Button>
        </div>
      ) : loading ? (
        <TableSkeleton columns={5} label={t("Load ho raha hai")} />
      ) : visits.length === 0 ? (
        <EmptyState
          icon={<MapPinned />}
          title={t("Abhi koi Site Visit nahi hai")}
          description={t("Nayi Site Visit raise karein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("No.")}</TableHead>
                <TableHead>{t("Customer")}</TableHead>
                <TableHead>{t("Visit For")}</TableHead>
                <TableHead>{t("Doer(s)")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visits.map((v) => (
                <TableRow key={v.id} className="cursor-pointer" onClick={() => setOpenId(v.id)}>
                  <TableCell className="font-medium"><Button variant="link" size="sm" aria-label={`${t("View details")}: ${v.displayNo}`} onClick={(event) => { event.stopPropagation(); setOpenId(v.id); }}>{v.displayNo}</Button></TableCell>
                  <TableCell>{v.customerName}</TableCell>
                  <TableCell>{t(VISIT_FOR_LABEL[v.visitFor])}</TableCell>
                  <TableCell>{v.assignments.map((a) => a.doerName).join(", ") || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={v.status === "Completed" ? "success" : "secondary"}>
                      {t(SITE_VISIT_STATUS_LABEL[v.status])}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SiteVisitDetailDialog
        visitId={openId}
        currentUserId={currentUserId}
        canWork={canWork}
        onOpenChange={(open) => !open && setOpenId(null)}
        onUpdated={() => setVersion((v) => v + 1)}
      />
    </div>
  );
}
