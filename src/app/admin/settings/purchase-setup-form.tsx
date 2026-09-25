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
import { Textarea } from "@/components/ui/textarea";
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

type TatUnit = "Minutes" | "Hours" | "Days";

interface DirectoryUser {
  userId: string;
  fullName: string;
}

interface PurchaseSetup {
  step1TatValue: number;
  step1TatUnit: TatUnit;
  step1Doer: string;
  step2TatValue: number;
  step2TatUnit: TatUnit;
  step2Doer: string;
  step3Doer: string;
  step4Doer: string;
  gstPercentDefault: number;
  defaultTerms: string;
  defaultNote: string;
}

const DEFAULT_SETUP: PurchaseSetup = {
  step1TatValue: 4,
  step1TatUnit: "Hours",
  step1Doer: "",
  step2TatValue: 4,
  step2TatUnit: "Hours",
  step2Doer: "",
  step3Doer: "",
  step4Doer: "",
  gstPercentDefault: 18,
  defaultTerms: "",
  defaultNote: "",
};

function DoerPicker({
  label,
  value,
  onChange,
  users,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  users: DirectoryUser[];
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value || undefined} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("User select karein")} />
        </SelectTrigger>
        <SelectContent>
          {users.map((u) => (
            <SelectItem key={u.userId} value={u.userId}>
              {u.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function TatFields({
  value,
  unit,
  onValueChange,
  onUnitChange,
}: {
  value: number;
  unit: TatUnit;
  onValueChange: (v: number) => void;
  onUnitChange: (u: TatUnit) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Label>TAT</Label>
        <Input
          type="number"
          step="any"
          min="0"
          value={value}
          onChange={(e) => onValueChange(Number(e.target.value))}
        />
      </div>
      <div className="space-y-2">
        <Label>{t("Unit")}</Label>
        <Select value={unit} onValueChange={(v) => v && onUnitChange(v as TatUnit)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Minutes">{t("Minutes")}</SelectItem>
            <SelectItem value="Hours">{t("Hours")}</SelectItem>
            <SelectItem value="Days">{t("Days")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * The Purchase flow's 4-step setup: a Doer per step, plus a fixed TAT for the two steps
 * that have one (Indent Approve, PO Issue). Step 3 (Follow Up) and Step 4 (Material
 * Received) deliberately have no TAT field here — their deadline comes from the vendor's
 * own Lead Time instead, computed per PO at Issue time.
 */
export default function PurchaseSetupForm() {
  const t = useT();
  const [setup, setSetup] = useState<PurchaseSetup>(DEFAULT_SETUP);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/settings/purchase-setup").then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(([setupData, usersData]: [{ setup?: PurchaseSetup }, { users?: DirectoryUser[] }]) => {
        if (setupData.setup) setSetup(setupData.setup);
        setUsers(usersData.users ?? []);
      })
      .catch(() => toast.error(t("Purchase Setup load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/purchase-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("Purchase Setup save ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={4} label={t("Purchase Setup load ho raha hai")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Purchase — Setup")}</CardTitle>
        <CardDescription>
          {t(
            "Indent Approve se Material Received tak — har step ka Doer aur (jahan lagu ho) TAT set karein. Step 3 aur 4 ka time vendor ke Lead Time se khud ban jaata hai."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">1. {t("Indent Approve")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DoerPicker
              label={t("Doer")}
              value={setup.step1Doer}
              onChange={(v) => setSetup((s) => ({ ...s, step1Doer: v }))}
              users={users}
            />
            <TatFields
              value={setup.step1TatValue}
              unit={setup.step1TatUnit}
              onValueChange={(v) => setSetup((s) => ({ ...s, step1TatValue: v }))}
              onUnitChange={(u) => setSetup((s) => ({ ...s, step1TatUnit: u }))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">2. {t("PO Issue")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DoerPicker
              label={t("Doer")}
              value={setup.step2Doer}
              onChange={(v) => setSetup((s) => ({ ...s, step2Doer: v }))}
              users={users}
            />
            <TatFields
              value={setup.step2TatValue}
              unit={setup.step2TatUnit}
              onValueChange={(v) => setSetup((s) => ({ ...s, step2TatValue: v }))}
              onUnitChange={(u) => setSetup((s) => ({ ...s, step2TatUnit: u }))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">3. {t("Follow Up")}</p>
          <DoerPicker
            label={t("Doer")}
            value={setup.step3Doer}
            onChange={(v) => setSetup((s) => ({ ...s, step3Doer: v }))}
            users={users}
          />
          <p className="text-xs text-muted-foreground">
            {t("Time = PO Issue ka actual time + Vendor ka Lead Time − 1 din.")}
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">4. {t("Material Received")}</p>
          <DoerPicker
            label={t("Doer")}
            value={setup.step4Doer}
            onChange={(v) => setSetup((s) => ({ ...s, step4Doer: v }))}
            users={users}
          />
          <p className="text-xs text-muted-foreground">
            {t("Time = PO Issue ka actual time + Vendor ka poora Lead Time.")}
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">{t("PO Document Defaults")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Ye values naye PO ke GST%/Note/Terms me pehle se bhar jaayengi — PO Issue karte waqt inhe badla bhi ja sakta hai.")}
          </p>
          <div className="space-y-2">
            <Label>{t("Default GST %")}</Label>
            <Input
              type="number"
              step="any"
              min="0"
              max="100"
              className="max-w-40"
              value={setup.gstPercentDefault}
              onChange={(e) => setSetup((s) => ({ ...s, gstPercentDefault: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Default Note")}</Label>
            <Textarea
              rows={2}
              value={setup.defaultNote}
              onChange={(e) => setSetup((s) => ({ ...s, defaultNote: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Default Terms & Conditions")}</Label>
            <Textarea
              rows={5}
              value={setup.defaultTerms}
              onChange={(e) => setSetup((s) => ({ ...s, defaultTerms: e.target.value }))}
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
