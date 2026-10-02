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
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface ComplianceSettings {
  pfEnabled: boolean;
  esiEnabled: boolean;
  tdsEnabled: boolean;
}

/**
 * All three statutory deductions (PF/ESI/TDS — src/lib/payroll/statutory.ts) are OFF by
 * default for every organization — turning one on here is the only way it starts
 * affecting a payroll run's numbers, so no existing org's payslips change unless an Admin
 * deliberately opts in here. These are calculation-only toggles — they make a payslip's
 * own numbers show the deduction; they do NOT file anything with EPFO/ESIC/the Income Tax
 * department. An org's own accountant/CA still files the real returns using these figures.
 */
export default function PayrollComplianceForm() {
  const t = useT();
  const [settings, setSettings] = useState<ComplianceSettings>({
    pfEnabled: false,
    esiEnabled: false,
    tdsEnabled: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/payroll-compliance")
      .then((res) => res.json())
      .then((data: ComplianceSettings) => setSettings(data))
      .catch(() => toast.error(t("Payroll Compliance settings load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/payroll-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("Payroll Compliance settings save ho gayi."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={3} label={t("Payroll Compliance settings load ho rahi hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Payroll — Statutory Compliance")}</CardTitle>
        <CardDescription>
          {t(
            "PF/ESI/TDS har organization ke liye default OFF hain — enable karne par hi payslips me ye deductions dikhenge. Ye sirf calculation hai, koi government filing nahi karta — aapka CA/accountant hi EPFO/ESIC/Income Tax me real return file karega, inhi figures ka use karke."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={settings.pfEnabled}
            onChange={(e) => setSettings((s) => ({ ...s, pfEnabled: e.target.checked }))}
          />
          <span>
            <Label className="cursor-pointer">PF (Provident Fund)</Label>
            <p className="text-xs text-muted-foreground">
              {t("12% employee + 12% employer (8.33% EPS + 3.67% EPF), ₹15,000/month wage ceiling.")}
            </p>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={settings.esiEnabled}
            onChange={(e) => setSettings((s) => ({ ...s, esiEnabled: e.target.checked }))}
          />
          <span>
            <Label className="cursor-pointer">ESI (Employees&apos; State Insurance)</Label>
            <p className="text-xs text-muted-foreground">
              {t("0.75% employee + 3.25% employer, sirf ₹21,000/month ya kam gross wage walon ke liye.")}
            </p>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={settings.tdsEnabled}
            onChange={(e) => setSettings((s) => ({ ...s, tdsEnabled: e.target.checked }))}
          />
          <span>
            <Label className="cursor-pointer">TDS (estimated)</Label>
            <p className="text-xs text-muted-foreground">
              {t(
                "New tax regime slabs ka ek estimate — employee ke investment declarations ya purani job ka TDS consider nahi karta. Final Form 16 nahi hai."
              )}
            </p>
          </span>
        </label>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? t("Saving...") : t("Save")}
        </Button>
      </CardContent>
    </Card>
  );
}
