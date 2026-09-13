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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface ShiftDraft {
  start: string;
  end: string;
  lunchStart: string;
  lunchEnd: string;
  teaStart: string;
  teaEnd: string;
}

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const MAX_SHIFTS = 4;

function blankShift(): ShiftDraft {
  return { start: "09:00", end: "18:00", lunchStart: "13:00", lunchEnd: "13:30", teaStart: "", teaEnd: "" };
}

export default function FmsShiftForm() {
  const t = useT();
  const [shifts, setShifts] = useState<ShiftDraft[]>([]);
  const [weeklyOffDays, setWeeklyOffDays] = useState<number[]>([0]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/fms-shifts")
      .then((res) => res.json())
      .then((data: { shifts: ShiftDraft[]; weeklyOffDays: number[] }) => {
        setShifts(data.shifts.length ? data.shifts : [blankShift()]);
        setWeeklyOffDays(data.weeklyOffDays.length ? data.weeklyOffDays : [0]);
      })
      .catch(() => toast.error(t("Shift settings load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  function setShift(index: number, patch: Partial<ShiftDraft>) {
    setShifts((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function toggleWeekday(day: number, checked: boolean) {
    setWeeklyOffDays((prev) => (checked ? [...prev, day] : prev.filter((d) => d !== day)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/fms-shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shifts, weeklyOffDays }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("Shift settings save ho gayi."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={4} label={t("Shift settings load ho rahi hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Company Running Time (FMS)")}</CardTitle>
        <CardDescription>
          {t(
            "FMS turnaround time sirf in working hours ke andar count hoti hai — shift, lunch, aur (agar diya ho) tea break ke bahar ka time nahi gina jaata."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {shifts.map((shift, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {t("Shift")} {i + 1}
              </p>
              {shifts.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShifts((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  {t("Hatayein")}
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`shift-${i}-start`}>{t("Shuru")}</Label>
                <Input
                  id={`shift-${i}-start`}
                  type="time"
                  value={shift.start}
                  onChange={(e) => setShift(i, { start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`shift-${i}-end`}>{t("Khatam")}</Label>
                <Input
                  id={`shift-${i}-end`}
                  type="time"
                  value={shift.end}
                  onChange={(e) => setShift(i, { end: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`shift-${i}-lunch-start`}>{t("Lunch shuru")}</Label>
                <Input
                  id={`shift-${i}-lunch-start`}
                  type="time"
                  value={shift.lunchStart}
                  onChange={(e) => setShift(i, { lunchStart: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`shift-${i}-lunch-end`}>{t("Lunch khatam")}</Label>
                <Input
                  id={`shift-${i}-lunch-end`}
                  type="time"
                  value={shift.lunchEnd}
                  onChange={(e) => setShift(i, { lunchEnd: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`shift-${i}-tea-start`}>{t("Tea shuru (optional)")}</Label>
                <Input
                  id={`shift-${i}-tea-start`}
                  type="time"
                  value={shift.teaStart}
                  onChange={(e) => setShift(i, { teaStart: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`shift-${i}-tea-end`}>{t("Tea khatam (optional)")}</Label>
                <Input
                  id={`shift-${i}-tea-end`}
                  type="time"
                  value={shift.teaEnd}
                  onChange={(e) => setShift(i, { teaEnd: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}

        {shifts.length < MAX_SHIFTS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShifts((prev) => [...prev, blankShift()])}
          >
            {t("Ek aur shift")}
          </Button>
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("Weekly Off")}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              "In dino ko default off maana jaayega. Kisi khaas date ko kholna ho (jaise ek Sunday production ke liye) to Week-off Overrides me add karein."
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
            {WEEKDAYS.map((day) => (
              <label
                key={day.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm"
              >
                <Checkbox
                  checked={weeklyOffDays.includes(day.value)}
                  onCheckedChange={(next) => toggleWeekday(day.value, next === true)}
                />
                {t(day.label)}
              </label>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
