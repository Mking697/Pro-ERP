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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FormSkeleton } from "@/components/loading-states";

interface ConnectionRow {
  key: string;
  label: string;
  url: string;
  kind: "sheet" | "drive";
}

const DRIVE_ROW_KEY = "DRIVE_FOLDER";

export default function SheetConnectionsForm() {
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/settings/sheets").then((res) => res.json()),
      fetch("/api/admin/settings/drive-folder").then((res) => res.json()),
    ])
      .then(
        ([sheetsData, driveData]: [
          { modules: { key: string; label: string; url: string }[] },
          { url: string },
        ]) => {
          const sheetRows: ConnectionRow[] = (sheetsData.modules ?? []).map((m) => ({
            key: m.key,
            label: m.label,
            url: m.url,
            kind: "sheet" as const,
          }));
          const driveRow: ConnectionRow = {
            key: DRIVE_ROW_KEY,
            label: "File Storage (Drive Folder)",
            url: driveData.url ?? "",
            kind: "drive",
          };
          const all = [...sheetRows, driveRow];
          setRows(all);

          const initialDrafts: Record<string, string> = {};
          for (const r of all) initialDrafts[r.key] = r.url;
          setDrafts(initialDrafts);
        }
      )
      .catch(() => toast.error("Settings load nahi ho payi."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(row: ConnectionRow) {
    const url = drafts[row.key]?.trim();
    if (!url) {
      toast.error("Pehle URL daalein.");
      return;
    }

    setSavingKey(row.key);
    try {
      const endpoint =
        row.kind === "drive" ? "/api/admin/settings/drive-folder" : "/api/admin/settings/sheets";
      const body = row.kind === "drive" ? { url } : { moduleKey: row.key, url };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Save nahi ho paya.");
        return;
      }

      toast.success("Connect ho gaya.");
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, url } : r)));
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <FormSkeleton fields={6} label="Sheet connections load ho rahi hain" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Sheets & Drive Connections</CardTitle>
        <CardDescription>
          Har module ke liye alag Google Sheet ka, aur attachments ke liye ek Drive folder ka,
          link paste karein. Har ek ko pehle Service Account email ke saath Editor access se
          share karna zaroori hai. Sheet ka header row pehli entry save hote hi apne aap ban
          jaayega.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {rows.map((row, i) => (
          <div key={row.key}>
            <div className="flex items-center justify-between">
              <Label htmlFor={row.key}>{row.label}</Label>
              <Badge variant={row.url ? "default" : "secondary"}>
                {row.url ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                id={row.key}
                placeholder={
                  row.kind === "drive"
                    ? "https://drive.google.com/drive/folders/..."
                    : "https://docs.google.com/spreadsheets/d/..."
                }
                value={drafts[row.key] ?? ""}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))
                }
              />
              <Button onClick={() => handleSave(row)} disabled={savingKey === row.key}>
                {savingKey === row.key ? "Saving..." : "Save"}
              </Button>
            </div>
            {i < rows.length - 1 && <Separator className="mt-6" />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
