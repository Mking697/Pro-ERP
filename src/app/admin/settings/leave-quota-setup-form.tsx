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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Other"] as const;

/**
 * Per-leave-type annual quota — opt-in per type. A blank/0 field means that leave type has
 * no cap at all; a filled field is a hard annual limit `createLeave()` enforces (flat, no
 * accrual/carry-forward, by explicit user choice).
 */
export default function LeaveQuotaSetupForm() {
  const t = useT();
  const [quotas, setQuotas] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/leave-quota-setup")
      .then((res) => res.json())
      .then((data: { quotas?: Record<string, number> }) => {
        const next: Record<string, string> = {};
        for (const lt of LEAVE_TYPES) {
          const value = data.quotas?.[lt];
          next[lt] = value ? String(value) : "";
        }
        setQuotas(next);
      })
      .catch(() => toast.error(t("Leave Quota Setup load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/leave-quota-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotas: LEAVE_TYPES.map((lt) => ({
            leaveType: lt,
            annualDays: Number(quotas[lt]) || 0,
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
    return <FormSkeleton fields={2} label={t("Leave Quota Setup load ho raha hai")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Leave — Quota Setup")}</CardTitle>
        <CardDescription>
          {t(
            "Har Leave Type ke liye saalana kitne din milte hain — khaali ya 0 rakhein to us type par koi limit nahi hogi. Yahan set kiya gaya quota har financial/calendar year me apne aap reset ho jaata hai (koi carry-forward nahi)."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {LEAVE_TYPES.map((lt) => (
            <div key={lt} className="space-y-2">
              <Label htmlFor={`quota-${lt}`}>{t(lt)}</Label>
              <Input
                id={`quota-${lt}`}
                type="number"
                min={0}
                max={365}
                placeholder={t("Unlimited")}
                value={quotas[lt] ?? ""}
                onChange={(e) => setQuotas((q) => ({ ...q, [lt]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <Button type="button" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
