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
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { CalendarOff } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";
import ApplyLeaveDialog from "./apply-leave-dialog";
import EmergencyLeaveDialog from "./emergency-leave-dialog";
import type { LeaveRow } from "./types";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Approved") return "default";
  if (status === "Rejected" || status === "Cancelled") return "destructive";
  return "secondary";
}

export default function MyLeavesBoard({
  currentUserId,
  canFileEmergency,
}: {
  currentUserId: string;
  canFileEmergency: boolean;
}) {
  const t = useT();
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const confirm = useConfirm();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/leave/leaves")
      .then((res) => res.json())
      .then((data: { leaves?: LeaveRow[] }) => setLeaves(data.leaves ?? []))
      .catch(() => toast.error(t("Leaves load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  function handleCreated(leave: LeaveRow) {
    setLeaves((prev) => [leave, ...prev]);
  }

  async function handleCancel(leave: LeaveRow) {
    setBusyId(leave.id);
    try {
      const res = await fetch(`/api/leave/leaves/${leave.id}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Cancel nahi ho paya."));
        return;
      }
      toast.success(t("Leave cancel ho gayi."));
      setVersion((v) => v + 1);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <TableSkeleton columns={6} label={t("Leaves load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ApplyLeaveDialog currentUserId={currentUserId} onCreated={handleCreated} />
        {canFileEmergency && <EmergencyLeaveDialog onCreated={handleCreated} />}
      </div>

      {leaves.length === 0 ? (
        <EmptyState
          icon={<CalendarOff />}
          title={t("Abhi koi leave nahi hai")}
          description={t("Apply karne par yahan dikhegi.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Doer")}</TableHead>
                <TableHead>{t("Leave Type")}</TableHead>
                <TableHead>{t("Dates")}</TableHead>
                <TableHead>{t("Buddy")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leaves.map((leave) => {
                const canCancel =
                  (leave.doerId === currentUserId || leave.filedBy === currentUserId) &&
                  (leave.status === "Pending" || leave.status === "Approved");
                const busy = busyId === leave.id;
                return (
                  <TableRow key={leave.id}>
                    <TableCell>
                      <span className="block font-medium">{leave.doerName}</span>
                      {leave.isEmergency && (
                        <span className="text-xs text-muted-foreground">
                          {t("Emergency — file kiya")} {leave.filedByName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{t(leave.leaveType)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {leave.startDate} → {leave.endDate}
                    </TableCell>
                    <TableCell>{leave.buddyName}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(leave.status)}>{leave.status}</Badge>
                      {leave.activatedAt && !leave.revertedAt && (
                        <span className="block text-xs text-muted-foreground">
                          {t("Buddy ko kaam mil chuka hai")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canCancel && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            confirm.ask({
                              title: t("Leave cancel karein?"),
                              description: t(
                                "Agar buddy ko kaam mil chuka hai to wo turant wapas ho jaayega."
                              ),
                              confirmLabel: t("Haan, cancel karein"),
                              onConfirm: () => handleCancel(leave),
                            })
                          }
                        >
                          {t("Cancel")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {confirm.dialog}
    </div>
  );
}
