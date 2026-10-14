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
import EvidenceFile from "@/components/field-service/evidence-file";
import ActivityTimeline from "@/components/field-service/activity-timeline";
import { useT } from "@/components/preferences-provider";
import { COMPLAINT_STATUS_LABEL, type ComplaintRow } from "./types";

export default function ComplaintDetailDialog({
  complaintId,
  currentUserId,
  canWork,
  onOpenChange,
  onUpdated,
}: {
  complaintId: string | null;
  currentUserId: string;
  canWork: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const t = useT();
  const { task: complaint, activities, history, loading, error, refresh } = useTaskDetail<ComplaintRow>("/api/complaints", complaintId, "complaint");
  function updated() { onUpdated(); refresh(); }

  const isAssignedDoer = Boolean(complaint?.status !== "Completed" && complaint?.assignments.some((a) => a.doerId === currentUserId));

  return (
    <Dialog open={Boolean(complaintId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {complaint ? `${complaint.displayNo} — ${complaint.customerName}` : t("Load ho raha hai...")}
            {complaint && (
              <Badge variant={complaint.status === "Completed" ? "success" : "secondary"}>
                {t(COMPLAINT_STATUS_LABEL[complaint.status])}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">{t(error)}</p>
            <Button variant="outline" size="sm" onClick={refresh}>{t("Retry")}</Button>
          </div>
        ) : loading || !complaint ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">{t("Warranty")}:</span> {complaint.warrantyStatus === "In_Warranty" ? t("In Warranty") : t("Out of Warranty")}</div>
              <div><span className="text-muted-foreground">{t("Reference")}:</span> {complaint.jobReference || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">{t("Issue")}:</span> {complaint.issueDescription}</div>
              <div className="col-span-2"><span className="text-muted-foreground">{t("Site Address")}:</span> {complaint.siteAddress || "—"}</div>
              <div><span className="text-muted-foreground">{t("Attendant")}:</span> {complaint.attendantName || "—"}</div>
              <div><span className="text-muted-foreground">{t("Phone")}:</span> {complaint.attendantPhone || "—"}</div>
            </div>

            <EvidenceFile url={complaint.attachmentUrl} label={t("Attachment")} />
            {complaint.mediaUrls.map((url, index) => <EvidenceFile key={`${index}:${url}`} url={url} label={t("Complaint Media")} />)}
            <TaskAssignments key={`${complaint.id}:${complaint.currentCycle}`} taskType="COMPLAINT" taskId={complaint.id} cycle={complaint.currentCycle} completed={complaint.status === "Completed"} assignments={complaint.assignments} canWork={canWork} onUpdated={updated} />
            <p className="text-sm text-muted-foreground">{t("Current cycle")}: {complaint.currentCycle}</p>

            <TaskStepPanel
              key={`${complaint.id}:${complaint.currentCycle}`}
              taskType="COMPLAINT"
              taskId={complaint.id}
              cycle={complaint.currentCycle}
              isAssignedDoer={isAssignedDoer}
              step={complaint.step}
              onUpdated={updated}
            />

            <TaskHistory taskType="COMPLAINT" taskId={complaint.id} currentCycle={complaint.currentCycle} history={history} />

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
