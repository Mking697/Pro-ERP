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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

type Scope = "ALL" | "DEPARTMENT" | "USER";

interface OverrideRow {
  Override_ID: string;
  Date: string;
  Scope: string;
  Scope_Value: string;
  Created_By: string;
  Created_At: string;
}

const SCOPE_LABEL: Record<Scope, string> = {
  ALL: "Sabke liye",
  DEPARTMENT: "Ek Department ke liye",
  USER: "Ek User ke liye",
};

export default function FmsWeekoffOverridesForm() {
  const t = useT();
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState("");
  const [scope, setScope] = useState<Scope>("ALL");
  const [scopeValue, setScopeValue] = useState("");

  useEffect(() => {
    fetch("/api/fms/weekoff-overrides")
      .then((res) => res.json())
      .then((data: { overrides?: OverrideRow[] }) => setOverrides(data.overrides ?? []))
      .catch(() => toast.error(t("Overrides load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleAdd() {
    if (!date) {
      toast.error(t("Date chunein."));
      return;
    }
    if (scope !== "ALL" && !scopeValue.trim()) {
      toast.error(t("Department ya User ID bharein."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/fms/weekoff-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, scope, scopeValue }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Override add nahi hua."));
        return;
      }
      setOverrides((prev) => [data.override, ...prev]);
      setDate("");
      setScopeValue("");
      toast.success(t("Override add ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={3} label={t("Overrides load ho rahe hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Weekly Off Overrides")}</CardTitle>
        <CardDescription>
          {t(
            "Kisi normally-off date (jaise ek khaas Sunday) ko sabke liye, ek Department ke liye, ya ek user ke liye working khol dein."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="override-date">Date</Label>
            <Input id="override-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="override-scope">{t("Scope")}</Label>
            <Select value={scope} onValueChange={(value) => value && setScope(value as Scope)}>
              <SelectTrigger id="override-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(SCOPE_LABEL[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="override-value">
              {scope === "USER" ? "User ID" : scope === "DEPARTMENT" ? t("Department") : "—"}
            </Label>
            <Input
              id="override-value"
              value={scopeValue}
              onChange={(e) => setScopeValue(e.target.value)}
              disabled={scope === "ALL"}
              placeholder={scope === "USER" ? "UID-XXXXXXXX" : ""}
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full">
              {saving ? "Adding..." : t("Add")}
            </Button>
          </div>
        </div>

        {overrides.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>{t("Scope")}</TableHead>
                  <TableHead>{t("Value")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((o) => (
                  <TableRow key={o.Override_ID}>
                    <TableCell>{o.Date}</TableCell>
                    <TableCell>{t(SCOPE_LABEL[o.Scope as Scope] ?? o.Scope)}</TableCell>
                    <TableCell>{o.Scope_Value || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
