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
import FmsTemplateForm from "./fms-template-form";
import { parseNextStepMap, parseOutcomeOptions } from "./template-format";
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
  const [version, setVersion] = useState(0);

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

  if (loading) {
    return <CardListSkeleton label={t("Templates load ho rahe hain")} />;
  }

  if (setupRequired) {
    return <SheetNotConnected what={setupRequired} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <FmsTemplateForm
          onCreated={() => setVersion((v) => v + 1)}
          userOptions={Object.entries(userMap).map(([userId, fullName]) => ({ userId, fullName }))}
        />
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<Workflow />}
          title={t("Abhi koi flow template nahi hai")}
          description={t("Naya template banayein taaki multi-step flows run ho sakein.")}
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
                      <Button
                        variant={template.status === "Active" ? "outline" : "default"}
                        size="sm"
                        disabled={busyId === template.templateId}
                        onClick={() => toggleStatus(template)}
                      >
                        {template.status === "Active" ? t("Archive") : t("Activate")}
                      </Button>
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
                                <TableCell className="font-medium">{step.Step_Name}</TableCell>
                                <TableCell>
                                  {userMap[step.Assigned_To] ?? step.Assigned_To}
                                </TableCell>
                                <TableCell>
                                  {step.TAT_Value} {step.TAT_Unit}
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
    </div>
  );
}
