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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function InwardIqcTatForm() {
  const t = useT();
  const [tatValue, setTatValue] = useState("24");
  const [tatUnit, setTatUnit] = useState<"Hours" | "Days">("Hours");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/inward-iqc-tat")
      .then((res) => res.json())
      .then((data: { tatValue: number; tatUnit: "Hours" | "Days" }) => {
        setTatValue(String(data.tatValue));
        setTatUnit(data.tatUnit);
      })
      .catch(() => toast.error(t("IQC TAT settings load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/inward-iqc-tat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tatValue: Number(tatValue), tatUnit }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("IQC TAT save ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={2} label={t("IQC TAT settings load ho rahi hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Inward IQC — Turnaround Time")}</CardTitle>
        <CardDescription>
          {t(
            "Ek nayi Inward entry ke liye IQC check kitne time me hona chahiye — deadline company ke working hours (Settings me set shift/lunch/tea/weekly-off) ke hisaab se ginti hai. Baaki Inward flow (entry, verify, Pass/Fail routing) bilkul waisa hi rehta hai."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="iqc-tat-value">TAT</Label>
            <Input
              id="iqc-tat-value"
              type="number"
              step="any"
              min="0"
              value={tatValue}
              onChange={(e) => setTatValue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="iqc-tat-unit">{t("Unit")}</Label>
            <Select value={tatUnit} onValueChange={(value) => value && setTatUnit(value as "Hours" | "Days")}>
              <SelectTrigger id="iqc-tat-unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Hours">{t("Hours")}</SelectItem>
                <SelectItem value="Days">{t("Days")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Ye sirf nayi entries par lagu hoga — jo entries pehle se ban chuki hain unki deadline nahi badlegi.")}
        </p>
      </CardContent>
    </Card>
  );
}
