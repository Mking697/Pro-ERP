"use client";

import { Button } from "@/components/ui/button";
import { useTaskDetail } from "@/components/field-service/use-task-detail";
import TaskHistory from "@/components/field-service/task-history";
import TaskAssignments from "@/components/field-service/task-assignments";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import TaskStepPanel from "@/components/field-service/task-step-panel";
import ActivityTimeline from "@/components/field-service/activity-timeline";
import { useT } from "@/components/preferences-provider";
import { SERVICE_STATUS_LABEL, type ServiceJobRow } from "./types";

export default function ServiceDetailDialog({
  jobId,
  currentUserId,
  canWork,
  onOpenChange,
  onUpdated,
}: {
  jobId: string | null;
  currentUserId: string;
  canWork: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const t = useT();
  const { task: job, activities, history, loading, error, refresh } = useTaskDetail<ServiceJobRow>("/api/services", jobId, "job");
  function updated() { onUpdated(); refresh(); }

  const isAssignedDoer = Boolean(job?.status !== "Completed" && job?.assignments.some((a) => a.doerId === currentUserId));

  return (
    <Dialog open={Boolean(jobId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {job?.customerName ?? t("Load ho raha hai...")}
            {job && <Badge variant={job.status === "Completed" ? "success" : "secondary"}>{t(SERVICE_STATUS_LABEL[job.status])}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">{t(error)}</p>
            <Button variant="outline" size="sm" onClick={refresh}>{t("Retry")}</Button>
          </div>
        ) : loading || !job ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">{t("Product")}:</span> {job.productDetails || "—"}</div>
              <div><span className="text-muted-foreground">{t("Brand")}:</span> {job.brand || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">{t("Site Address")}:</span> {job.siteAddress || "—"}</div>
              <div><span className="text-muted-foreground">{t("Attendant")}:</span> {job.attendantName || "—"}</div>
              <div><span className="text-muted-foreground">{t("Phone")}:</span> {job.attendantPhone || "—"}</div>
            </div>

            <TaskAssignments key={`${job.id}:${job.currentCycle}`} taskType="SERVICE" taskId={job.id} cycle={job.currentCycle} completed={job.status === "Completed"} assignments={job.assignments} canWork={canWork} onUpdated={updated} />
            <p className="text-sm text-muted-foreground">{t("Current cycle")}: {job.currentCycle}</p>

            <TaskStepPanel
              key={`${job.id}:${job.currentCycle}`}
              taskType="SERVICE"
              taskId={job.id}
              cycle={job.currentCycle}
              isAssignedDoer={isAssignedDoer}
              step={job.step}
              onUpdated={updated}
            />

            <TaskHistory taskType="SERVICE" taskId={job.id} currentCycle={job.currentCycle} history={history} />

            {activities.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("Timeline")}</p>
                <ActivityTimeline activities={activities} />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
