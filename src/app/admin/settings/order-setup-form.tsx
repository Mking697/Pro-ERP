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

type TatUnit = "Minutes" | "Hours" | "Days";

interface DirectoryUser {
  userId: string;
  fullName: string;
}

interface OrderSetup {
  step1TatValue: number;
  step1TatUnit: TatUnit;
  step1Doer: string;
  step2TatValue: number;
  step2TatUnit: TatUnit;
  step2Doer: string;
  step3TatValue: number;
  step3TatUnit: TatUnit;
  step3Doer: string;
  step4TatValue: number;
  step4TatUnit: TatUnit;
  step4Doer: string;
  creditHoldApprover: string;
}

const DEFAULT_SETUP: OrderSetup = {
  step1TatValue: 4,
  step1TatUnit: "Hours",
  step1Doer: "",
  step2TatValue: 4,
  step2TatUnit: "Hours",
  step2Doer: "",
  step3TatValue: 4,
  step3TatUnit: "Hours",
  step3Doer: "",
  step4TatValue: 4,
  step4TatUnit: "Hours",
  step4Doer: "",
  creditHoldApprover: "",
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
 * The Order flow's setup: a Doer + TAT per working step (Items Mapping/Payment Review/
 * Stock Check/Dispatch Commit — informational/administrative, mirroring Purchase Setup's
 * own shape exactly), plus a separate Credit-Hold Approver — the one field here that IS
 * actually enforced (src/lib/orders/orders.ts's approveCreditHold), deliberately not tied
 * to a module grant since it's a specific, org-configured person.
 */
export default function OrderSetupForm() {
  const t = useT();
  const [setup, setSetup] = useState<OrderSetup>(DEFAULT_SETUP);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/settings/order-setup").then((res) => res.json()),
      fetch("/api/users/directory").then((res) => res.json()),
    ])
      .then(([setupData, usersData]: [{ setup?: OrderSetup }, { users?: DirectoryUser[] }]) => {
        if (setupData.setup) setSetup(setupData.setup);
        setUsers(usersData.users ?? []);
      })
      .catch(() => toast.error(t("Order Setup load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/order-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("Order Setup save ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={4} label={t("Order Setup load ho raha hai")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Order — Setup")}</CardTitle>
        <CardDescription>
          {t(
            "Items Mapping se Dispatch Commit tak — har step ka Doer aur TAT set karein, aur Credit Hold clear karne wala approver chunein."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">1. {t("Items Mapping")}</p>
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
          <p className="text-sm font-medium">2. {t("Payment Review")}</p>
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
          <p className="text-sm font-medium">3. {t("Stock Check")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DoerPicker
              label={t("Doer")}
              value={setup.step3Doer}
              onChange={(v) => setSetup((s) => ({ ...s, step3Doer: v }))}
              users={users}
            />
            <TatFields
              value={setup.step3TatValue}
              unit={setup.step3TatUnit}
              onValueChange={(v) => setSetup((s) => ({ ...s, step3TatValue: v }))}
              onUnitChange={(u) => setSetup((s) => ({ ...s, step3TatUnit: u }))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">4. {t("Dispatch Commit")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <DoerPicker
              label={t("Doer")}
              value={setup.step4Doer}
              onChange={(v) => setSetup((s) => ({ ...s, step4Doer: v }))}
              users={users}
            />
            <TatFields
              value={setup.step4TatValue}
              unit={setup.step4TatUnit}
              onValueChange={(v) => setSetup((s) => ({ ...s, step4TatValue: v }))}
              onUnitChange={(u) => setSetup((s) => ({ ...s, step4TatUnit: u }))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-destructive/30 p-3">
          <p className="text-sm font-medium">{t("Credit-Hold Approver")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Sirf ye user (ya Admin) hi kisi order ka Credit Hold clear kar sakta hai — ye step ka Doer nahi hai.")}
          </p>
          <DoerPicker
            label={t("Approver")}
            value={setup.creditHoldApprover}
            onChange={(v) => setSetup((s) => ({ ...s, creditHoldApprover: v }))}
            users={users}
          />
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
