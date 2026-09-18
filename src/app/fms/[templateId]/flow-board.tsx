"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDueDisplay } from "@/lib/formatDate";
import { parseStamp, byNewest } from "@/lib/timestamp";
import { parseStepDataSourceConfig, parseFormData, type FormField } from "@/lib/fms/dataSource";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Workflow } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type { FmsRunRecord } from "../types";

interface StepDef {
  stepNo: number;
  stepName: string;
  assignedTo: string;
  dataSourceConfig: string;
}

interface InstancesResponse {
  templateName?: string;
  steps?: StepDef[];
  runs?: FmsRunRecord[];
  references?: Record<string, string>;
}

/** One row of the board — every FMS_RUNS row of one instance, grouped. */
interface InstanceRow {
  instanceId: string;
  reference: string;
  startedAt: string;
  runs: FmsRunRecord[];
}

/** Mirrors isFmsStepOverdue() in src/lib/fms/engine.ts — a live label, never stored. */
function isOverdue(run: FmsRunRecord): boolean {
  if (run.Status !== "Pending" || !run.TAT_Deadline) return false;
  const deadline = parseStamp(run.TAT_Deadline);
  return deadline !== null && new Date() > deadline;
}

type BoardStatus = "On Time" | "Delay Done" | "Not Done" | "In Progress";

function classifyInstance(runs: FmsRunRecord[]): BoardStatus {
  const open = runs.filter((r) => r.Status === "Pending");
  if (open.length > 0) {
    return open.some(isOverdue) ? "Not Done" : "In Progress";
  }
  return runs.some((r) => r.Status === "Delay Done") ? "Delay Done" : "On Time";
}

function statusVariant(status: BoardStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "On Time") return "default";
  if (status === "Delay Done") return "secondary";
  if (status === "Not Done") return "destructive";
  return "outline"; // In Progress
}

export default function FlowBoard({ templateId }: { templateId: string }) {
  const t = useT();
  const [steps, setSteps] = useState<StepDef[]>([]);
  const [runs, setRuns] = useState<FmsRunRecord[]>([]);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openInstanceId, setOpenInstanceId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/fms/templates/${templateId}/instances`).then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(
        ([data, usersData]: [
          InstancesResponse,
          { users: { userId: string; fullName: string }[] },
        ]) => {
          setSteps(data.steps ?? []);
          setRuns(data.runs ?? []);
          setReferences(data.references ?? {});

          const map: Record<string, string> = {};
          for (const u of usersData.users ?? []) map[u.userId] = u.fullName;
          setUserMap(map);
        }
      )
      .catch(() => toast.error(t("Flow ka data load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [templateId, t]);

  const instances = useMemo<InstanceRow[]>(() => {
    const byInstance = new Map<string, FmsRunRecord[]>();
    for (const run of runs) {
      const list = byInstance.get(run.Instance_ID) ?? [];
      list.push(run);
      byInstance.set(run.Instance_ID, list);
    }

    const rows: InstanceRow[] = [];
    for (const [instanceId, instanceRuns] of byInstance) {
      rows.push({
        instanceId,
        reference: references[instanceId] ?? instanceId,
        startedAt: instanceRuns[0]?.Started_At ?? "",
        runs: instanceRuns,
      });
    }
    return rows.sort((a, b) => byNewest(a.startedAt, b.startedAt));
  }, [runs, references]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return instances;
    return instances.filter((row) => row.reference.toLowerCase().includes(q));
  }, [instances, search]);

  const openInstance = instances.find((i) => i.instanceId === openInstanceId) ?? null;

  if (loading) {
    return <TableSkeleton columns={5} label={t("Flow load ho raha hai")} />;
  }

  if (instances.length === 0) {
    return (
      <EmptyState
        icon={<Workflow />}
        title={t("Is flow ka abhi tak koi instance nahi chala")}
        description={t("Jaise hi ye flow kisi trigger se ya manually start hoga, wo yahan dikhega.")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("Reference search karein...")}
        className="h-9 max-w-sm"
      />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Reference")}</TableHead>
              <TableHead>{t("Current Step")}</TableHead>
              <TableHead>{t("Kiske Paas")}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>{t("Shuru Hua")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {t("Is search se koi instance nahi mila.")}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((row) => {
              const open = row.runs.filter((r) => r.Status === "Pending");
              const status = classifyInstance(row.runs);
              const currentStepLabel =
                open.length > 0 ? open.map((r) => r.Step_Name).join(" + ") : t("Complete");
              const currentAssignee =
                open.length > 0
                  ? open.map((r) => userMap[r.Assigned_To] ?? r.Assigned_To).join(", ")
                  : "—";

              return (
                <TableRow
                  key={row.instanceId}
                  className="cursor-pointer"
                  onClick={() => setOpenInstanceId(row.instanceId)}
                >
                  <TableCell className="font-medium">{row.reference}</TableCell>
                  <TableCell>{currentStepLabel}</TableCell>
                  <TableCell className="text-muted-foreground">{currentAssignee}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(status)}>{status}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDueDisplay(row.startedAt)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={openInstance !== null}
        onOpenChange={(open) => !open && setOpenInstanceId(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{openInstance?.reference}</DialogTitle>
            <DialogDescription>
              {t("Shuru hua")} {formatDueDisplay(openInstance?.startedAt ?? "")}
            </DialogDescription>
          </DialogHeader>

          {openInstance && (
            <InstanceStepper steps={steps} runs={openInstance.runs} userMap={userMap} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The vertical step list inside the row-click dialog — always in the template's own
 * Step_No order, not the order runs happened to be created in (a rework loop can create a
 * later Run_ID for an earlier Step_No). A step this instance never reached yet renders as
 * a plain "not started" placeholder rather than being omitted. */
function InstanceStepper({
  steps,
  runs,
  userMap,
}: {
  steps: StepDef[];
  runs: FmsRunRecord[];
  userMap: Record<string, string>;
}) {
  const t = useT();

  return (
    <div className="space-y-4">
      {[...steps]
        .sort((a, b) => a.stepNo - b.stepNo)
        .map((step) => {
          const attempts = runs
            .filter((r) => Number(r.Step_No) === step.stepNo)
            .sort((a, b) => (parseStamp(a.Created_At)?.getTime() ?? 0) - (parseStamp(b.Created_At)?.getTime() ?? 0));

          const config = parseStepDataSourceConfig(step.dataSourceConfig);
          const fieldLabels = new Map<string, string>(
            (config.form?.fields ?? []).map((f: FormField) => [f.key, f.label])
          );

          return (
            <div key={step.stepNo} className="border-l-2 pl-4">
              <p className="text-sm font-semibold">
                {step.stepNo}. {step.stepName}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("Assigned")}: {(userMap[step.assignedTo] ?? step.assignedTo) || "—"}
              </p>

              {attempts.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground italic">
                  {t("Abhi shuru nahi hua.")}
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  {attempts.map((run, i) => {
                    const formData = parseFormData(run.Form_Data);
                    const entries = Object.entries(formData);
                    return (
                      <div key={run.Run_ID} className="rounded-md bg-muted/40 p-3 text-sm">
                        {attempts.length > 1 && (
                          <p className="text-xs font-medium text-muted-foreground">
                            {t("Attempt")} {i + 1}
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                          <div>
                            <span className="text-xs text-muted-foreground">{t("Plan")}</span>
                            <p>{formatDueDisplay(run.TAT_Deadline)}</p>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">{t("Actual")}</span>
                            <p>{run.Completed_At ? formatDueDisplay(run.Completed_At) : "—"}</p>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">Outcome</span>
                            <p>{run.Outcome || "—"}</p>
                          </div>
                          {run.Quantity && (
                            <div>
                              <span className="text-xs text-muted-foreground">Qty</span>
                              <p>{run.Quantity}</p>
                            </div>
                          )}
                        </div>

                        {entries.length > 0 && (
                          <div className="mt-2 space-y-0.5 border-t pt-2">
                            {entries.map(([key, value]) => (
                              <div key={key} className="flex justify-between gap-2">
                                <span className="text-muted-foreground">
                                  {fieldLabels.get(key) ?? key}
                                </span>
                                <span className="font-medium">{value || "—"}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {run.Remark && (
                          <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                            {t("Remark")}: {run.Remark}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
