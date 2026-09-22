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
import { Separator } from "@/components/ui/separator";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { DispatchDetailRow } from "./types";

export default function DispatchDetailDialog({
  dispatchId,
  open,
  onOpenChange,
  onChanged,
}: {
  dispatchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<DispatchDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [proofOfDispatchUrl, setProofOfDispatchUrl] = useState("");

  function load() {
    fetch(`/api/dispatch/${dispatchId}`)
      .then((res) => res.json())
      .then((data: DispatchDetailRow) => setDetail(data))
      .catch(() => toast.error(t("Dispatch details load nahi ho paye.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dispatchId]);

  async function markDispatched() {
    setBusy(true);
    try {
      const res = await fetch(`/api/dispatch/${dispatchId}/mark-dispatched`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofOfDispatchUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Mark Dispatched nahi ho paya."));
        return;
      }
      toast.success(t("Shipment Dispatch ho gayi."));
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail?.dispatch.gatePassNo || dispatchId}
            {detail && (
              <Badge variant={detail.dispatch.status === "Dispatched" ? "default" : "secondary"}>
                {detail.dispatch.status === "Dispatched" ? t("Dispatched") : t("In Transit")}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail ? `${detail.order.partyName} · ${detail.dispatch.shipmentId}` : t("Details aur activity timeline")}
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-3 text-sm">
              <p>
                {t("Assignee")}: <span className="font-medium">{detail.dispatch.assignedToName || detail.dispatch.assignedTo}</span>
              </p>
              <p>
                {t("TAT")}: {detail.dispatch.tatValue} {detail.dispatch.tatUnit}
                {detail.dispatch.tatDeadline && (
                  <> · {t("Deadline")}: {new Date(detail.dispatch.tatDeadline).toLocaleString("en-IN")}</>
                )}
              </p>
              {detail.dispatch.gatePassAttachmentUrl && (
                <p>
                  <a
                    href={detail.dispatch.gatePassAttachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {t("Gate Pass Attachment dekhein")}
                  </a>
                </p>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">{t("Items")}</p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {detail.dispatch.items.map((i) => (
                  <li key={i.lineNo}>
                    {i.itemName}: {i.qty} {i.uom}
                  </li>
                ))}
              </ul>
            </div>

            {detail.dispatch.status === "In_Transit" ? (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{t("Mark Dispatched")}</p>
                <FileUploadField
                  label={t("Proof of Dispatch (optional)")}
                  value={proofOfDispatchUrl}
                  onChange={setProofOfDispatchUrl}
                />
                <Button size="sm" disabled={busy} onClick={markDispatched}>
                  {t("Mark Dispatched")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                <p>
                  {t("Dispatch ho gaya")}: {detail.dispatch.dispatchedBy} ·{" "}
                  {detail.dispatch.dispatchedAt ? new Date(detail.dispatch.dispatchedAt).toLocaleString("en-IN") : ""}
                </p>
                {detail.dispatch.proofOfDispatchUrl && (
                  <a
                    href={detail.dispatch.proofOfDispatchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    {t("Proof of Dispatch dekhein")}
                  </a>
                )}
                {detail.orderFullyDispatched && (
                  <p className="font-medium">
                    {t("Ye order ab poora Dispatch ho chuka hai — Sales chain ka safar yahan poora hota hai.")}
                  </p>
                )}
              </div>
            )}

            <Separator />

            <div>
              <p className="mb-2 text-sm font-medium">History</p>
              <div className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {detail.activities.length === 0 && (
                  <p className="text-muted-foreground">{t("Abhi koi activity nahi hai.")}</p>
                )}
                {detail.activities.map((a) => (
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
