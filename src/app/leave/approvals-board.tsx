"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { UserCheck } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type { LeaveRow } from "./types";

/** Every leave currently waiting on this viewer's own decision — the step they're the
 * resolved approver for, whether that's because it's their Reporting Manager slot or a
 * fixed "Specific person" step (HR, MD, ...) named in Leave Approval Setup. */
export default function ApprovalsBoard() {
  const t = useT();
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/leave/approvals")
      .then((res) => res.json())
      .then((data: { leaves?: LeaveRow[] }) => setLeaves(data.leaves ?? []))
      .catch(() => toast.error(t("Approvals load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  async function decide(leave: LeaveRow, decision: "Approved" | "Rejected") {
    setBusyId(leave.id);
    try {
      const res = await fetch(`/api/leave/leaves/${leave.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, remark: remarkDraft[leave.id] ?? "" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Decision save nahi hua."));
        return;
      }
      toast.success(decision === "Approved" ? t("Leave approve ho gayi.") : t("Leave reject ho gayi."));
      setVersion((v) => v + 1);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <TableSkeleton columns={5} label={t("Approvals load ho rahe hain")} />;
  }

  if (leaves.length === 0) {
    return (
      <EmptyState
        icon={<UserCheck />}
        title={t("Abhi koi leave aapke approval ka wait nahi kar rahi")}
        description={t("Jab koi leave aapke step tak pahunchegi, wo yahan dikhegi.")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Doer")}</TableHead>
            <TableHead>{t("Leave Type")}</TableHead>
            <TableHead>{t("Dates")}</TableHead>
            <TableHead>{t("Reason")}</TableHead>
            <TableHead>{t("Step")}</TableHead>
            <TableHead>{t("Remark")}</TableHead>
            <TableHead className="text-right">{t("Action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leaves.map((leave) => {
            const busy = busyId === leave.id;
            const totalSteps = leave.approvals.length;
            return (
              <TableRow key={leave.id}>
                <TableCell>
                  <span className="block font-medium">{leave.doerName}</span>
                  {leave.isEmergency && (
                    <Badge variant="secondary" className="mt-1">
                      {t("Emergency")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{t(leave.leaveType)}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {leave.startDate} → {leave.endDate}
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                  {leave.reason || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {leave.currentStepNo} / {totalSteps}
                </TableCell>
                <TableCell>
                  <Input
                    value={remarkDraft[leave.id] ?? ""}
                    onChange={(e) => setRemarkDraft((d) => ({ ...d, [leave.id]: e.target.value }))}
                    placeholder={t("Optional remark")}
                    className="h-8 min-w-40"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" disabled={busy} onClick={() => decide(leave, "Approved")}>
                      {t("Approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => decide(leave, "Rejected")}
                    >
                      {t("Reject")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
