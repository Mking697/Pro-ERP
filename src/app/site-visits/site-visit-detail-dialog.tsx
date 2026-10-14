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
import { SITE_VISIT_STATUS_LABEL, VISIT_FOR_LABEL, type SiteVisitRow } from "./types";

export default function SiteVisitDetailDialog({
  visitId,
  currentUserId,
  canWork,
  onOpenChange,
  onUpdated,
}: {
  visitId: string | null;
  currentUserId: string;
  canWork: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const t = useT();
  const { task: visit, activities, history, loading, error, refresh } = useTaskDetail<SiteVisitRow>("/api/site-visits", visitId, "visit");
  function updated() { onUpdated(); refresh(); }

  const isAssignedDoer = Boolean(visit?.status !== "Completed" && visit?.assignments.some((a) => a.doerId === currentUserId));

  return (
    <Dialog open={Boolean(visitId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {visit ? `${visit.displayNo} — ${visit.customerName}` : t("Load ho raha hai...")}
            {visit && (
              <Badge variant={visit.status === "Completed" ? "success" : "secondary"}>
                {t(SITE_VISIT_STATUS_LABEL[visit.status])}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-destructive">{t(error)}</p>
            <Button variant="outline" size="sm" onClick={refresh}>{t("Retry")}</Button>
          </div>
        ) : loading || !visit ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">{t("Visit For")}:</span> {t(VISIT_FOR_LABEL[visit.visitFor])}</div>
              <div><span className="text-muted-foreground">{t("Raised Via")}:</span> {visit.raisedVia || "—"}</div>
              <div className="col-span-2"><span className="text-muted-foreground">{t("Site Address")}:</span> {visit.siteAddress || "—"}</div>
              <div><span className="text-muted-foreground">{t("Attendant")}:</span> {visit.attendantName || "—"}</div>
              <div><span className="text-muted-foreground">{t("Phone")}:</span> {visit.attendantPhone || "—"}</div>
            </div>

            {visit.siteLatitude != null && visit.siteLongitude != null && <p className="text-sm">{t("Planned site location")}: {visit.siteLatitude}, {visit.siteLongitude}</p>}
            <TaskAssignments key={`${visit.id}:${visit.currentCycle}`} taskType="SITE_VISIT" taskId={visit.id} cycle={visit.currentCycle} completed={visit.status === "Completed"} assignments={visit.assignments} canWork={canWork} onUpdated={updated} />
            <p className="text-sm text-muted-foreground">{t("Current cycle")}: {visit.currentCycle}</p>

            <TaskStepPanel
              key={`${visit.id}:${visit.currentCycle}`}
              taskType="SITE_VISIT"
              taskId={visit.id}
              cycle={visit.currentCycle}
              isAssignedDoer={isAssignedDoer}
              step={visit.step}
              onUpdated={updated}
            />

            <TaskHistory taskType="SITE_VISIT" taskId={visit.id} currentCycle={visit.currentCycle} history={history} />

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
