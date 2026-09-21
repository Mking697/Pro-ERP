"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

type ApproverType = "REPORTING_MANAGER" | "SPECIFIC_USER";

interface StepDraft {
  id: number;
  approverType: ApproverType;
  specificUserId: string;
}

interface UserOption {
  userId: string;
  fullName: string;
}

let nextId = 1;

/**
 * The org's Leave approval chain — zero, one, or many steps, in order. A "Reporting
 * Manager" step resolves differently per requester (whoever their own Users record names);
 * a "Specific person" step is fixed (e.g. HR, MD), the same pattern Purchase Setup already
 * uses for naming a fixed Doer per step. Empty chain = leave requests auto-approve.
 */
export default function LeaveApprovalSetupForm() {
  const t = useT();
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/settings/leave-approval-setup").then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(
        ([setupData, usersData]: [
          { steps?: { approverType: ApproverType; specificUserId: string }[] },
          { users?: UserOption[] },
        ]) => {
          setSteps(
            (setupData.steps ?? []).map((s) => ({
              id: nextId++,
              approverType: s.approverType,
              specificUserId: s.specificUserId,
            }))
          );
          setUserOptions(usersData.users ?? []);
        }
      )
      .catch(() => toast.error(t("Leave Approval Setup load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  function addStep() {
    setSteps((prev) => [...prev, { id: nextId++, approverType: "REPORTING_MANAGER", specificUserId: "" }]);
  }

  function removeStep(id: number) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }

  function moveStep(id: number, direction: -1 | 1) {
    setSteps((prev) => {
      const index = prev.findIndex((s) => s.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setStep(id: number, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    if (steps.some((s) => s.approverType === "SPECIFIC_USER" && !s.specificUserId)) {
      toast.error(t("Har 'Specific person' step ke liye ek user chunein."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/leave-approval-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: steps.map((s) => ({
            approverType: s.approverType,
            specificUserId: s.specificUserId,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }
      toast.success(t("Save ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={3} label={t("Leave Approval Setup load ho raha hai")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Leave — Approval Setup")}</CardTitle>
        <CardDescription>
          {t(
            "Leave file hone ke baad kis-kis se approval chahiye, kis order me — ek step ho ya kai. 'Reporting Manager' har doer ke liye alag resolve hoga (unki apni profile me set); 'Specific person' hamesha wahi ek fixed insaan hoga (jaise HR, MD)."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.length === 0 && (
          <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            {t("Koi step nahi hai — is org me leave requests seedhe approve ho jaayengi, kisi approval ka wait nahi hoga.")}
          </p>
        )}
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-center gap-2 rounded-lg border p-3">
            <span className="w-6 shrink-0 text-sm font-medium text-muted-foreground">
              {index + 1}.
            </span>
            <Select
              value={step.approverType}
              onValueChange={(v) => v && setStep(step.id, { approverType: v as ApproverType })}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REPORTING_MANAGER">{t("Reporting Manager")}</SelectItem>
                <SelectItem value="SPECIFIC_USER">{t("Specific person")}</SelectItem>
              </SelectContent>
            </Select>

            {step.approverType === "SPECIFIC_USER" && (
              <Select
                value={step.specificUserId || undefined}
                onValueChange={(v) => v && setStep(step.id, { specificUserId: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("User chunein")} />
                </SelectTrigger>
                <SelectContent>
                  {userOptions.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={index === 0}
                onClick={() => moveStep(step.id, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={index === steps.length - 1}
                onClick={() => moveStep(step.id, 1)}
              >
                ↓
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeStep(step.id)}>
                {t("Hatayein")}
              </Button>
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addStep}>
            {t("Ek aur step")}
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
