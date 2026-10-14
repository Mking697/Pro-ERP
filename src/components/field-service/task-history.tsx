"use client";

import { useT } from "@/components/preferences-provider";
import TaskStepPanel, { type FieldStepData } from "./task-step-panel";
import TaskAssignments from "./task-assignments";
import type { FieldTaskType } from "./assign-doers-dialog";

export interface FieldCycleHistory {
  cycle: number;
  step: FieldStepData;
  assignments: { doerId: string; doerName: string; fundAmount: number | null; fundNotes: string }[];
}

export default function TaskHistory({ taskType, taskId, currentCycle, history }: {
  taskType: FieldTaskType; taskId: string; currentCycle: number; history: FieldCycleHistory[] | null;
}) {
  const t = useT();
  if (currentCycle <= 1) return null;
  if (history === null) return <p className="text-sm text-muted-foreground">{t("Previous cycle evidence is not available in this view. Timeline shows recorded activity only.")}</p>;
  const previous = history.filter((entry) => entry.cycle < currentCycle && entry.step.step3At);
  return <section className="space-y-2">
    <h3 className="text-sm font-medium">{t("Completed History")}</h3>
    {previous.length === 0 ? <p className="text-sm text-muted-foreground">{t("No previous completed cycles available.")}</p> : previous.map((entry) => <details key={entry.cycle} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">{t("Completed cycle")}: {entry.cycle}</summary>
      <div className="mt-3 space-y-3">
        <TaskAssignments taskType={taskType} taskId={taskId} cycle={entry.cycle} completed assignments={entry.assignments} canWork={false} onUpdated={() => {}} />
        <TaskStepPanel taskType={taskType} taskId={taskId} cycle={entry.cycle} isAssignedDoer={false} step={entry.step} onUpdated={() => {}} />
      </div>
    </details>)}
  </section>;
}
