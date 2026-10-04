"use client";

import { useCallback, useEffect, useState } from "react";
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
import { Wrench, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import { formatDueDisplay } from "@/lib/formatDate";
import ReportBreakdownDialog from "./report-breakdown-dialog";
import NewMaintenanceRequestDialog from "./new-request-dialog";
import type { MaintenanceRequestRow, MaintenanceStatus } from "./types";

const KIND_LABEL: Record<string, string> = {
  Breakdown: "Breakdown",
  Generator_Repair: "Generator Repair",
  Servicing: "Servicing",
  Wiring: "Wiring",
  Light_Change: "Light Change",
  Other: "Other",
};

function statusVariant(status: MaintenanceStatus) {
  if (status === "Open") return "destructive" as const;
  if (status === "Fixed_By_Maintenance") return "default" as const;
  if (status === "Resolved") return "success" as const;
  return "outline" as const;
}

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  Open: "Open",
  Fixed_By_Maintenance: "Fixed — Confirm Pending",
  Resolved: "Resolved",
  Cancelled: "Cancelled",
};

export default function MaintenanceBoard({
  currentUserId,
  canWork,
}: {
  currentUserId: string;
  canWork: boolean;
}) {
  const t = useT();
  const [rows, setRows] = useState<MaintenanceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/maintenance")
      .then((res) => res.json())
      .then((data: { requests?: MaintenanceRequestRow[] }) => setRows(data.requests ?? []))
      .catch(() => toast.error(t("Maintenance requests load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  function handleReported(request: MaintenanceRequestRow) {
    setRows((prev) => [request, ...prev]);
  }

  function handleCreated(request: MaintenanceRequestRow) {
    setRows((prev) => [request, ...prev]);
  }

  async function act(id: string, body: Record<string, unknown>, url: string, done: string) {
    setBusy(id);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Kaam nahi hua."));
        return;
      }
      toast.success(done);
      refresh();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <TableSkeleton label={t("Maintenance requests load ho rahi hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <ReportBreakdownDialog onReported={handleReported} />
        <NewMaintenanceRequestDialog onCreated={handleCreated} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title={t("Abhi koi maintenance request nahi hai")}
          description={t("Breakdown ya kisi aur kaam ke liye upar se request banayein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Type")}</TableHead>
                <TableHead>{t("Production Line")}</TableHead>
                <TableHead>{t("Details")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead>{t("Reported")}</TableHead>
                <TableHead className="text-right">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isReporter = row.reportedBy === currentUserId;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{t(KIND_LABEL[row.kind] ?? row.kind)}</TableCell>
                    <TableCell>
                      {row.productionLineTemplateName || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={row.description}>
                      {row.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{t(STATUS_LABEL[row.status])}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDueDisplay(row.reportedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canWork && row.status === "Open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === row.id}
                            onClick={() =>
                              act(
                                row.id,
                                { action: "fixed" },
                                `/api/maintenance/${row.id}`,
                                t("Mark kiya — confirm ka intezaar.")
                              )
                            }
                          >
                            <CheckCircle2 className="size-4" />
                            {t("Kaam Ho Gaya")}
                          </Button>
                        )}

                        {isReporter && row.status === "Fixed_By_Maintenance" && (
                          <>
                            <Button
                              size="sm"
                              disabled={busy === row.id}
                              onClick={() =>
                                act(
                                  row.id,
                                  { outcome: "confirm" },
                                  `/api/maintenance/${row.id}/confirm`,
                                  t("Confirm hua — Line resume ho gayi.")
                                )
                              }
                            >
                              <CheckCircle2 className="size-4" />
                              {t("Confirm Karein")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === row.id}
                              onClick={() =>
                                act(
                                  row.id,
                                  { outcome: "reopen" },
                                  `/api/maintenance/${row.id}/confirm`,
                                  t("Reopen hui.")
                                )
                              }
                            >
                              <RotateCcw className="size-4" />
                              {t("Theek Nahi Hua")}
                            </Button>
                          </>
                        )}

                        {canWork && (row.status === "Open" || row.status === "Fixed_By_Maintenance") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === row.id}
                            onClick={() =>
                              act(row.id, { action: "cancel" }, `/api/maintenance/${row.id}`, t("Cancel hui."))
                            }
                          >
                            <XCircle className="size-4" />
                            {t("Cancel")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
