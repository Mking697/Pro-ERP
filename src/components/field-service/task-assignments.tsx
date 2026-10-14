"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";
import AssignDoersDialog, { type FieldTaskType } from "./assign-doers-dialog";

interface Assignment { doerId: string; doerName: string; fundAmount: number | null; fundNotes: string }
const API_BASE: Record<FieldTaskType, string> = { SERVICE: "/api/services", COMPLAINT: "/api/complaints", SITE_VISIT: "/api/site-visits" };

export default function TaskAssignments({ taskType, taskId, cycle, completed, assignments, canWork, onUpdated }: {
  taskType: FieldTaskType; taskId: string; cycle: number; completed: boolean; assignments: Assignment[]; canWork: boolean; onUpdated: () => void;
}) {
  const t = useT();
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  async function unassign(doerId: string) {
    setRemoving(doerId);
    try {
      const res = await fetch(`${API_BASE[taskType]}/${taskId}/unassign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doerId, cycle }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Unassign nahi ho paya.");
      // Parent refresh reads the exact detail target back after mutation.
      onUpdated();
    } catch (error) {
      toast.error(t(error instanceof Error ? error.message : "Unassign nahi ho paya."));
    } finally { setRemoving(null); setConfirmId(null); }
  }
  return <div className="space-y-3 rounded-lg border p-3">
    <p className="text-sm font-medium">{t("Assigned Doers")}</p>
    {assignments.length === 0 ? <p className="text-sm text-muted-foreground">{t("Koi nahi")}</p> : assignments.map((a) => <div key={a.doerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <div><p>{a.doerName}</p>{a.fundAmount != null && <p className="text-muted-foreground">{t("Fund Advance (₹)")}: {a.fundAmount} {a.fundNotes}</p>}</div>
      {canWork && !completed && (confirmId === a.doerId ? <div className="flex items-center gap-2">
        <Button size="sm" variant="destructive" disabled={Boolean(removing)} onClick={() => unassign(a.doerId)}>{t("Unassign confirm karein")}</Button>
        <Button size="sm" variant="outline" disabled={Boolean(removing)} onClick={() => setConfirmId(null)}>{t("Cancel")}</Button>
      </div> : <Button size="sm" variant="outline" disabled={Boolean(removing)} onClick={() => setConfirmId(a.doerId)} aria-label={`${t("Unassign Doer")}: ${a.doerName}`}>{t("Unassign Doer")}</Button>)}
    </div>)}
    {canWork && <AssignDoersDialog taskType={taskType} taskId={taskId} cycle={cycle} reopening={completed} assignedDoerIds={completed ? [] : assignments.map((a) => a.doerId)} onAssigned={onUpdated} />}
  </div>;
}
