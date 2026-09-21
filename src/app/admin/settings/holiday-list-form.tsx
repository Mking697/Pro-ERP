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
import { FormSkeleton } from "@/components/loading-states";
import PartyImportDialog from "@/app/parties/party-import-dialog";
import { useT } from "@/components/preferences-provider";

interface HolidayRow {
  Date: string;
  Name: string;
}

/**
 * The org's Holiday List — every date here is a non-working day everywhere the app cares
 * (FMS TAT deadlines, IQC TAT, and now the Recurring Task generator too), on top of the
 * weekly-off day set in "Company Running Time" above.
 */
export default function HolidayListForm() {
  const t = useT();
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/admin/settings/holidays")
      .then((res) => res.json())
      .then((data: { holidays?: HolidayRow[] }) => setHolidays(data.holidays ?? []))
      .catch(() => toast.error(t("Holiday List load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  async function handleAdd() {
    if (!date) {
      toast.error(t("Date chunein."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Holiday add nahi hua."));
        return;
      }
      toast.success(t("Holiday add ho gaya."));
      setDate("");
      setName("");
      setVersion((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveName(row: HolidayRow) {
    const newName = editDraft[row.Date] ?? row.Name;
    setBusyDate(row.Date);
    try {
      const res = await fetch("/api/admin/settings/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: row.Date, name: newName }),
      });
      if (!res.ok) {
        toast.error(t("Save nahi ho paya."));
        return;
      }
      setHolidays((prev) => prev.map((h) => (h.Date === row.Date ? { ...h, Name: newName } : h)));
      toast.success(t("Save ho gaya."));
    } finally {
      setBusyDate(null);
    }
  }

  async function handleDelete(row: HolidayRow) {
    setBusyDate(row.Date);
    try {
      const res = await fetch(`/api/admin/settings/holidays/${encodeURIComponent(row.Date)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(t("Hata nahi paya."));
        return;
      }
      setHolidays((prev) => prev.filter((h) => h.Date !== row.Date));
    } finally {
      setBusyDate(null);
    }
  }

  if (loading) {
    return <FormSkeleton fields={3} label={t("Holiday List load ho rahi hai")} />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t("Holiday List")}</CardTitle>
          <PartyImportDialog
            entityLabel={t("Holiday")}
            templateUrl="/api/admin/settings/holidays/import-template"
            importUrl="/api/admin/settings/holidays/import"
            onImported={() => setVersion((v) => v + 1)}
          />
        </div>
        <CardDescription>
          {t(
            "In dates par koi bhi recurring task, FMS ya IQC deadline nahi ginti — weekly-off (upar wala) ke alawa ye extra non-working days hain."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="holiday-date">Date</Label>
            <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="holiday-name">{t("Naam (optional)")}</Label>
            <Input
              id="holiday-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Diwali"
            />
          </div>
          <div className="flex items-end">
            <Button type="button" onClick={handleAdd} disabled={saving} className="w-full">
              {saving ? "Adding..." : t("Add")}
            </Button>
          </div>
        </div>

        {holidays.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>{t("Naam")}</TableHead>
                  <TableHead className="text-right">{t("Action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => {
                  const busy = busyDate === h.Date;
                  const draft = editDraft[h.Date] ?? h.Name;
                  const changed = draft !== h.Name;
                  return (
                    <TableRow key={h.Date}>
                      <TableCell className="whitespace-nowrap">{h.Date}</TableCell>
                      <TableCell>
                        <Input
                          value={draft}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, [h.Date]: e.target.value }))
                          }
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {changed && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => handleSaveName(h)}
                            >
                              {t("Save")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => handleDelete(h)}
                          >
                            {t("Hatayein")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {holidays.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Abhi koi holiday nahi hai.")}</p>
        )}
      </CardContent>
    </Card>
  );
}
