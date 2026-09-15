"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import { CardListSkeleton } from "@/components/loading-states";
import SheetNotConnected from "@/components/sheet-not-connected";
import EmptyState from "@/components/empty-state";
import { Workflow } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import FmsTemplateForm from "./fms-template-form";
import { parseNextStepMap, parseOutcomeOptions } from "./template-format";
import { outcomeTypeDef, parseOutcomeType } from "@/lib/fms/outcomeType";
import type { FmsTemplateStepRecord } from "./types";

interface TemplateSummary {
  templateId: string;
  templateName: string;
  triggerEvent: string;
  status: string;
  createdAt: string;
  createdBy: string;
  steps: FmsTemplateStepRecord[];
}

export default function TemplatesBoard() {
  const t = useT();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTyped, setResetTyped] = useState("");
  const [resetting, setResetting] = useState(false);
  const confirm = useConfirm();
  const RESET_CONFIRM_WORD = "DELETE";

  useEffect(() => {
    Promise.all([
      fetch("/api/fms/templates").then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(
        ([templatesData, usersData]: [
          { templates?: TemplateSummary[]; setupRequired?: string | null },
          { users: { userId: string; fullName: string }[] },
        ]) => {
          setTemplates(templatesData.templates ?? []);
          setSetupRequired(templatesData.setupRequired ?? null);

          const map: Record<string, string> = {};
          for (const u of usersData.users ?? []) map[u.userId] = u.fullName;
          setUserMap(map);
        }
      )
      .catch(() => toast.error(t("Templates load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  async function toggleStatus(template: TemplateSummary) {
    const nextStatus = template.status === "Active" ? "Archived" : "Active";
    setBusyId(template.templateId);
    try {
      const res = await fetch(`/api/fms/templates/${template.templateId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Status badal nahi paya."));
        return;
      }
      setTemplates((prev) =>
        prev.map((tpl) =>
          tpl.templateId === template.templateId ? { ...tpl, status: nextStatus } : tpl
        )
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(template: TemplateSummary) {
    const res = await fetch(`/api/fms/templates/${template.templateId}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(t(data?.error ?? "Template delete nahi ho payi."));
      return;
    }
    toast.success(t("Template delete ho gayi."));
    setTemplates((prev) => prev.filter((tpl) => tpl.templateId !== template.templateId));
  }

  async function handleResetAll() {
    setResetting(true);
    try {
      const res = await fetch("/api/fms/reset", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Reset nahi ho paya."));
        return;
      }
      toast.success(
        `${data.templatesDeleted} template row(s) aur ${data.runsDeleted} run/history row(s) delete ho gaye.`
      );
      setResetOpen(false);
      setResetTyped("");
      setVersion((v) => v + 1);
    } finally {
      setResetting(false);
    }
  }

  async function startInstance(template: TemplateSummary) {
    setStartingId(template.templateId);
    try {
      const res = await fetch("/api/fms/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.templateId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Instance start nahi ho paya."));
        return;
      }
      toast.success(t("FMS start ho gaya — pehla step assign ho gaya."));
    } finally {
      setStartingId(null);
    }
  }

  if (loading) {
    return <CardListSkeleton label={t("Templates load ho rahe hain")} />;
  }

  if (setupRequired) {
    return <SheetNotConnected what={setupRequired} />;
  }

  const userOptions = Object.entries(userMap).map(([userId, fullName]) => ({ userId, fullName }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <FmsTemplateForm onCreated={() => setVersion((v) => v + 1)} userOptions={userOptions} />
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title={t("Abhi koi FMS template nahi hai")}
          description={t("Naya template banayein taaki multi-step FMS run ho sakein.")}
        />
      ) : (
        <div className="space-y-3">
          {templates.map((template) => {
            const isOpen = expanded === template.templateId;
            return (
              <Card key={template.templateId}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {template.templateName}
                        <Badge variant={template.status === "Active" ? "default" : "outline"}>
                          {template.status}
                        </Badge>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {template.steps.length} step(s) · {t("Trigger")}: {template.triggerEvent} ·{" "}
                        {formatDueDisplay(template.createdAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : template.templateId)}
                      >
                        {isOpen ? t("Chhupayein") : t("Steps dekhein")}
                      </Button>
                      {template.status === "Active" && template.triggerEvent === "MANUAL" && (
                        <Button
                          size="sm"
                          disabled={startingId === template.templateId}
                          onClick={() => startInstance(template)}
                        >
                          {startingId === template.templateId ? "Starting..." : t("Start")}
                        </Button>
                      )}
                      <FmsTemplateForm
                        onCreated={() => setVersion((v) => v + 1)}
                        userOptions={userOptions}
                        editing={{
                          templateId: template.templateId,
                          templateName: template.templateName,
                          triggerEvent: template.triggerEvent,
                          steps: template.steps,
                        }}
                      />
                      <Button
                        variant={template.status === "Active" ? "outline" : "default"}
                        size="sm"
                        disabled={busyId === template.templateId}
                        onClick={() => toggleStatus(template)}
                      >
                        {template.status === "Active" ? t("Archive") : t("Activate")}
                      </Button>
                      {template.status === "Archived" && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            confirm.ask({
                              title: `"${template.templateName}" ${t("delete karein?")}`,
                              description: t(
                                "Ye template permanently mit jaayegi. Isko koi Pending step abhi use nahi kar raha ho tabhi ye delete hogi — agar koi step abhi bhi chal raha hai, delete refuse ho jaayegi."
                              ),
                              confirmLabel: t("Haan, delete karein"),
                              onConfirm: () => handleDelete(template),
                            })
                          }
                        >
                          {t("Delete")}
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>{t("Step")}</TableHead>
                            <TableHead>{t("Assigned To")}</TableHead>
                            <TableHead>TAT</TableHead>
                            <TableHead>{t("Next step per outcome")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {template.steps.map((step) => {
                            const nextMap = parseNextStepMap(step.Next_Step_Map);
                            const outcomes = parseOutcomeOptions(step.Outcome_Options);
                            return (
                              <TableRow key={step.Step_No}>
                                <TableCell className="text-muted-foreground">
                                  {step.Step_No}
                                </TableCell>
                                <TableCell className="font-medium">
                                  {step.Step_Name}
                                  {(() => {
                                    const def = outcomeTypeDef(parseOutcomeType(step.Outcome_Type));
                                    return def ? (
                                      <Badge variant="outline" className="ml-2 font-normal">
                                        {t(def.label)}
                                      </Badge>
                                    ) : null;
                                  })()}
                                </TableCell>
                                <TableCell>
                                  {userMap[step.Assigned_To] ?? step.Assigned_To}
                                </TableCell>
                                <TableCell>
                                  {step.TAT_Source_Step_No ? (
                                    <span title={t("Step")+ " " + step.TAT_Source_Step_No + " ke field se, offset " + step.TAT_Offset}>
                                      {t("Step")} {step.TAT_Source_Step_No} {t("ka field")} ({step.TAT_Offset || 0})
                                    </span>
                                  ) : (
                                    `${step.TAT_Value} ${step.TAT_Unit}`
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {outcomes
                                    .map((o) => `${o} → ${nextMap[o] === "END" ? "End" : `Step ${nextMap[o]}`}`)
                                    .join(" · ")}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {templates.length > 0 && (
        <div className="flex justify-end border-t pt-4">
          <Button variant="destructive" size="sm" onClick={() => setResetOpen(true)}>
            {t("Saare FMS Templates + Runs Reset Karein")}
          </Button>
        </div>
      )}

      {confirm.dialog}

      {/* Wipes every template (any status) and every run/instance — pending and history
          both — for the whole org. Bigger blast radius than the per-template Delete above,
          so this asks for a typed word a stray click cannot produce, same reasoning as
          organization deletion in src/app/platform/organizations-table.tsx. */}
      <Dialog
        open={resetOpen}
        onOpenChange={(v) => {
          setResetOpen(v);
          if (!v) setResetTyped("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Saare FMS data reset karein?")}</DialogTitle>
            <DialogDescription>
              {t(
                "Ye is organization ke SAARE FMS templates (jo bhi design kiye gaye hain), aur unke saare runs — pending tasks aur poori history — permanently delete kar dega. Ye Google Sheets se hi mit jaata hai, wapas nahi aata."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="confirm-reset-word">
              {t("Pakka karne ke liye likhein")} <span className="font-mono">{RESET_CONFIRM_WORD}</span>
            </Label>
            <Input
              id="confirm-reset-word"
              value={resetTyped}
              onChange={(e) => setResetTyped(e.target.value)}
              placeholder={RESET_CONFIRM_WORD}
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              {t("Rehne dein")}
            </Button>
            <Button
              variant="destructive"
              disabled={resetting || resetTyped.trim() !== RESET_CONFIRM_WORD}
              onClick={handleResetAll}
            >
              {resetting ? t("Reset ho raha hai...") : t("Sab Delete Karein")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
