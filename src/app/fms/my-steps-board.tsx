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
import { CardListSkeleton } from "@/components/loading-states";
import SheetNotConnected from "@/components/sheet-not-connected";
import EmptyState from "@/components/empty-state";
import { Workflow } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type { FmsRunRecord } from "./types";
import CompleteStepDialog from "./complete-step-dialog";

/** A pending step is only "Not Done" once its deadline has passed — a live label, never
 * stored, mirroring isFmsStepOverdue() in src/lib/fms/engine.ts. */
function isOverdue(run: FmsRunRecord): boolean {
  const deadline = parseStamp(run.TAT_Deadline);
  return deadline !== null && new Date() > deadline;
}

export default function MyStepsBoard() {
  const t = useT();
  const [steps, setSteps] = useState<FmsRunRecord[]>([]);
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/fms/my-steps")
      .then((res) => res.json())
      .then((data: { steps?: FmsRunRecord[]; setupRequired?: string | null }) => {
        setSteps(data.steps ?? []);
        setSetupRequired(data.setupRequired ?? null);
      })
      .catch(() => toast.error(t("Steps load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  function handleCompleted(runId: string) {
    setSteps((prev) => prev.filter((s) => s.Run_ID !== runId));
    setVersion((v) => v + 1);
  }

  if (loading) {
    return <CardListSkeleton label={t("Steps load ho rahe hain")} />;
  }

  if (setupRequired) {
    return <SheetNotConnected what={setupRequired} />;
  }

  if (steps.length === 0) {
    return (
      <EmptyState
        icon={<Workflow />}
        title={t("Koi pending step nahi hai")}
        description={t("Kisi FMS ka step aapko assign hote hi yahan dikhega.")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Step")}</TableHead>
            <TableHead>{t("FMS")}</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>{t("Deadline")}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((run) => {
            const overdue = isOverdue(run);
            return (
              <TableRow key={run.Run_ID}>
                <TableCell className="font-medium">{run.Step_Name}</TableCell>
                <TableCell>{run.Template_Name}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {run.Quantity || "—"}
                </TableCell>
                <TableCell>{formatDueDisplay(run.TAT_Deadline)}</TableCell>
                <TableCell>
                  <Badge variant={overdue ? "destructive" : "secondary"}>
                    {overdue ? "Not Done" : "Pending"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <CompleteStepDialog
                    run={run}
                    onCompleted={() => handleCompleted(run.Run_ID)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
