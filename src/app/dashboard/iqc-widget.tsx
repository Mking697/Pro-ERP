"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDueDisplay } from "@/lib/formatDate";
import QualityCheckDialog from "@/app/inward/quality-check-dialog";
import type { InwardRecord } from "@/app/inward/types";
import { useT } from "@/components/preferences-provider";

export default function IqcWidget() {
  const t = useT();
  const [entries, setEntries] = useState<InwardRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inward")
      .then((res) => res.json())
      .then((data: { entries: InwardRecord[] }) =>
        setEntries((data.entries ?? []).filter((e) => e.IQC_Status === "Pending"))
      )
      .catch(() => toast.error(t("Pending IQC entries load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  function handleVerified(updated: InwardRecord) {
    setEntries((prev) => prev.filter((e) => e.Entry_ID !== updated.Entry_ID));
  }

  if (loading) return null;
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Quality Checks ({entries.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.Entry_ID}
            className="flex items-center justify-between rounded-lg border p-3 text-sm"
          >
            <div>
              <p className="font-medium">{entry.Party_Name}</p>
              <p className="text-muted-foreground">
                Invoice {entry.Invoice_No} · {entry.Inward_Type} ·{" "}
                {formatDueDisplay(entry.Timestamp)}
              </p>
            </div>
            <QualityCheckDialog entry={entry} onVerified={handleVerified} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
