"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import { PDI_STATUS_LABEL, type PdiActivityRow, type PdiInspectionRow } from "./types";

export default function PdiDetailDialog({
  pdiId,
  open,
  onOpenChange,
  onChanged,
}: {
  pdiId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [inspection, setInspection] = useState<PdiInspectionRow | null>(null);
  const [activities, setActivities] = useState<PdiActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [remark, setRemark] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");

  function load() {
    fetch(`/api/pdi/${pdiId}`)
      .then((res) => res.json())
      .then((data: { inspection?: PdiInspectionRow; activities?: PdiActivityRow[] }) => {
        if (data.inspection) setInspection(data.inspection);
        setActivities(data.activities ?? []);
      })
      .catch(() => toast.error(t("PDI load nahi ho payi.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pdiId]);

  async function submitResult(result: "Pass" | "Fail") {
    setBusy(true);
    try {
      const res = await fetch(`/api/pdi/${pdiId}/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, remark, attachmentUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Inspect nahi ho paya."));
        return;
      }
      toast.success(result === "Pass" ? t("Inspection Pass ho gayi.") : t("Inspection Fail record ho gayi."));
      setRemark("");
      setAttachmentUrl("");
      setInspection(data.inspection);
      onChanged();
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {pdiId}
            {inspection && (
              <Badge variant={inspection.status === "Passed" ? "default" : "secondary"}>
                {t(PDI_STATUS_LABEL[inspection.status])}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {inspection
              ? `${inspection.order.partyName} · Order ${inspection.orderId}`
              : t("Details aur inspection action")}
          </DialogDescription>
        </DialogHeader>

        {loading || !inspection ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">{t("Order Items")}</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Item")}</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">{t("Reserved")}</TableHead>
                      <TableHead className="text-right">{t("Short")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspection.order.items.map((line) => (
                      <TableRow key={line.lineNo}>
                        <TableCell>
                          <span className="block">{line.itemName}</span>
                          <span className="block text-xs text-muted-foreground">{line.sku}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.qty} {line.uom}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.reservedQty}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          {line.shortageQty > 0 ? line.shortageQty : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              {inspection.status === "Passed" ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                  {t("Inspection Pass ho chuki hai")} — {inspection.passedBy} ·{" "}
                  {inspection.passedAt ? new Date(inspection.passedAt).toLocaleString("en-IN") : ""}
                  {inspection.attachmentUrl && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={inspection.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {t("Report dekhein")}
                      </a>
                    </>
                  )}
                </div>
              ) : inspection.waitingForStock ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  {t(
                    "Ye order abhi stock ka wait kar raha hai — jab tak har line ka shortage clear na ho, inspect nahi ho sakta. Naya stock aane par ye automatically clear ho jaayega."
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{t("Inspection")}</p>
                  <Textarea
                    rows={2}
                    placeholder={t("Remark (optional)")}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                  />
                  <FileUploadField
                    label={t("Report (optional)")}
                    value={attachmentUrl}
                    onChange={setAttachmentUrl}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => submitResult("Pass")}>
                      {t("Pass")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => submitResult("Fail")}
                    >
                      {t("Fail")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-sm font-medium">History</p>
              <div className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {activities.length === 0 && (
                  <p className="text-muted-foreground">{t("Abhi koi activity nahi hai.")}</p>
                )}
                {activities.map((a) => (
                  <div key={a.id} className="rounded-md border p-2">
                    <p>{a.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
