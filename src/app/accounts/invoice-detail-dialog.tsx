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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { InvoiceDetailRow } from "./types";

export default function InvoiceDetailDialog({
  invoiceId,
  open,
  onOpenChange,
  onChanged,
}: {
  invoiceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<InvoiceDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceAttachmentUrl, setInvoiceAttachmentUrl] = useState("");
  const [ewayBillNo, setEwayBillNo] = useState("");
  const [ewayBillAttachmentUrl, setEwayBillAttachmentUrl] = useState("");
  const [extraDocumentUrl, setExtraDocumentUrl] = useState("");
  const [finalValue, setFinalValue] = useState("");

  function load() {
    fetch(`/api/accounts/invoices/${invoiceId}`)
      .then((res) => res.json())
      .then((data: InvoiceDetailRow) => {
        setDetail(data);
        setInvoiceNo(data.invoice.invoiceNo);
        setInvoiceAttachmentUrl(data.invoice.invoiceAttachmentUrl);
        setEwayBillNo(data.invoice.ewayBillNo);
        setEwayBillAttachmentUrl(data.invoice.ewayBillAttachmentUrl);
        setExtraDocumentUrl(data.invoice.extraDocumentUrl);
        setFinalValue(String(data.invoice.finalValue));
      })
      .catch(() => toast.error(t("Invoice load nahi ho payi.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const isDraft = detail?.invoice.status === "Draft";

  async function saveDraft() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNo,
          invoiceAttachmentUrl,
          ewayBillNo,
          ewayBillAttachmentUrl,
          extraDocumentUrl,
          finalValue: Number(finalValue),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Update nahi ho paya."));
        return;
      }
      toast.success(t("Invoice save ho gayi."));
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/invoices/${invoiceId}/issue`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Issue nahi ho paya."));
        return;
      }
      toast.success(t("Invoice Issue ho gayi."));
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
            {invoiceId}
            {detail && (
              <Badge variant={detail.invoice.status === "Issued" ? "default" : "secondary"}>
                {detail.invoice.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail ? `${detail.order.partyName} · Order ${detail.order.id}` : t("Details")}
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="rounded-lg border p-3 text-sm">
              <p>
                {t("Invoiced")}: ₹{detail.invoice.finalValue} · {t("Received")}: ₹{detail.totalReceived}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("Invoice No.")}</Label>
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} disabled={!isDraft} />
              </div>
              <div className="space-y-2">
                <Label>{t("Final Value")}</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={finalValue}
                  onChange={(e) => setFinalValue(e.target.value)}
                  disabled={!isDraft}
                />
              </div>
            </div>

            {isDraft ? (
              <FileUploadField
                label={t("Invoice Document")}
                value={invoiceAttachmentUrl}
                onChange={setInvoiceAttachmentUrl}
              />
            ) : (
              invoiceAttachmentUrl && (
                <a href={invoiceAttachmentUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary underline">
                  {t("Invoice Document dekhein")}
                </a>
              )
            )}

            <div className="space-y-2">
              <Label>{t("E-way Bill No.")}</Label>
              <Input value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} disabled={!isDraft} />
            </div>
            {isDraft ? (
              <FileUploadField
                label={t("E-way Bill Document")}
                value={ewayBillAttachmentUrl}
                onChange={setEwayBillAttachmentUrl}
              />
            ) : (
              ewayBillAttachmentUrl && (
                <a href={ewayBillAttachmentUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary underline">
                  {t("E-way Bill dekhein")}
                </a>
              )
            )}
            {isDraft ? (
              <FileUploadField
                label={t("Extra Document")}
                value={extraDocumentUrl}
                onChange={setExtraDocumentUrl}
              />
            ) : (
              extraDocumentUrl && (
                <a href={extraDocumentUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary underline">
                  {t("Extra Document dekhein")}
                </a>
              )
            )}

            {isDraft ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" disabled={busy} onClick={saveDraft}>
                  {t("Draft Save Karein")}
                </Button>
                <Button size="sm" disabled={busy} onClick={issue}>
                  {t("Issue Karein")}
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                {t("Issue ho chuki hai")} — {detail.invoice.issuedBy} ·{" "}
                {detail.invoice.issuedAt ? new Date(detail.invoice.issuedAt).toLocaleString("en-IN") : ""}
              </div>
            )}

            <Separator />
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
