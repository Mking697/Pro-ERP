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
import { Wrench } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import CreateServiceJobDialog from "./create-service-dialog";
import ServiceDetailDialog from "./service-detail-dialog";
import { SERVICE_STATUS_LABEL, type ServiceJobRow } from "./types";

export default function ServicesBoard({
  currentUserId,
  canWork,
}: {
  currentUserId: string;
  canWork: boolean;
}) {
  const t = useT();
  const [jobs, setJobs] = useState<ServiceJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/services", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data: { jobs?: ServiceJobRow[] }) => {
        if (!controller.signal.aborted) { setJobs(data.jobs ?? []); setError(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  return (
    <div className="space-y-4">
      {canWork && (
        <div className="flex justify-end">
          <CreateServiceJobDialog onCreated={() => setVersion((v) => v + 1)} />
        </div>
      )}

      {error ? (
        <div role="alert" className="space-y-2 rounded-lg border p-4">
          <p>{t("Task list load nahi ho payi.")}</p>
          <Button variant="outline" onClick={() => { setError(false); setLoading(true); setVersion((v) => v + 1); }}>{t("Retry")}</Button>
        </div>
      ) : loading ? (
        <TableSkeleton columns={5} label={t("Load ho raha hai")} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title={t("Abhi koi Service Job nahi hai")}
          description={t("Nayi Service Job banayein ya Doer assign hone ka wait karein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ID")}</TableHead>
                <TableHead>{t("Customer")}</TableHead>
                <TableHead>{t("Product")}</TableHead>
                <TableHead>{t("Doer(s)")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id} className="cursor-pointer" onClick={() => setOpenId(j.id)}>
                  <TableCell className="font-medium"><Button variant="link" size="sm" aria-label={`${t("View details")}: ${j.id}`} onClick={(event) => { event.stopPropagation(); setOpenId(j.id); }}>{j.id}</Button></TableCell>
                  <TableCell>{j.customerName}</TableCell>
                  <TableCell>{[j.productDetails, j.brand].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell>{j.assignments.map((a) => a.doerName).join(", ") || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={j.status === "Completed" ? "success" : "secondary"}>
                      {t(SERVICE_STATUS_LABEL[j.status])}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ServiceDetailDialog
        jobId={openId}
        currentUserId={currentUserId}
        canWork={canWork}
        onOpenChange={(open) => !open && setOpenId(null)}
        onUpdated={() => setVersion((v) => v + 1)}
      />
    </div>
  );
}
