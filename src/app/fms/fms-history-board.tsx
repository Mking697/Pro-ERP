"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import { TableSkeleton } from "@/components/loading-states";
import SheetNotConnected from "@/components/sheet-not-connected";
import EmptyState from "@/components/empty-state";
import { History } from "lucide-react";
import { useT } from "@/components/preferences-provider";

interface FmsHistoryRow {
  runId: string;
  instanceId: string;
  templateName: string;
  stepName: string;
  assignedTo: string;
  quantity: string;
  outcome: string;
  status: string;
  completedAt: string;
  tatDeadline: string;
  remark: string;
  jobNo: string;
  orderNo: string;
  productName: string;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "On Time") return "default";
  if (status === "Delay Done") return "secondary";
  return "destructive";
}

/**
 * Doer-wise, job-wise record of every FMS step that has left "Pending" — what was done,
 * by whom, when, and (when the flow was started from a production plan) which Job No /
 * Order No it belongs to.
 */
export default function FmsHistoryBoard() {
  const t = useT();
  const [rows, setRows] = useState<FmsHistoryRow[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/fms/history").then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(
        ([historyData, usersData]: [
          { history?: FmsHistoryRow[]; setupRequired?: string | null },
          { users: { userId: string; fullName: string }[] },
        ]) => {
          setRows(historyData.history ?? []);
          setSetupRequired(historyData.setupRequired ?? null);

          const map: Record<string, string> = {};
          for (const u of usersData.users ?? []) map[u.userId] = u.fullName;
          setUserMap(map);
        }
      )
      .catch(() => toast.error(t("History load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const doer = (userMap[r.assignedTo] ?? r.assignedTo).toLowerCase();
      return (
        doer.includes(q) ||
        r.jobNo.toLowerCase().includes(q) ||
        r.orderNo.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        r.stepName.toLowerCase().includes(q) ||
        r.templateName.toLowerCase().includes(q)
      );
    });
  }, [rows, userMap, search]);

  if (loading) {
    return <TableSkeleton columns={7} label={t("History load ho rahi hai")} />;
  }

  if (setupRequired) {
    return <SheetNotConnected what={setupRequired} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title={t("Abhi koi history nahi hai")}
        description={t("Jaise hi koi FMS step complete hoga, wo yahan dikhega.")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("Doer, Job No, Order No, ya Step search karein...")}
        className="h-9 max-w-sm"
      />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Doer")}</TableHead>
              <TableHead>{t("Job / Order No")}</TableHead>
              <TableHead>{t("Step")}</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>{t("Kab")}</TableHead>
              <TableHead>{t("Remark")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {t("Is search se koi history nahi mili.")}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((row) => (
              <TableRow key={row.runId}>
                <TableCell className="font-medium">
                  {userMap[row.assignedTo] ?? row.assignedTo}
                </TableCell>
                <TableCell className="text-xs">
                  {row.jobNo || row.orderNo ? (
                    <>
                      {row.jobNo && <span className="block">{row.jobNo}</span>}
                      {row.orderNo && (
                        <span className="block text-muted-foreground">{row.orderNo}</span>
                      )}
                      {row.productName && (
                        <span className="block text-muted-foreground">{row.productName}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.stepName}
                  <span className="block text-xs text-muted-foreground">
                    {row.templateName}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.quantity || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{row.outcome || row.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDueDisplay(row.completedAt)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.remark || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
