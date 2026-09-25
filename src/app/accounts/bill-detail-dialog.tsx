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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { BillDetailRow, BillPaymentMode } from "./types";

const PAYMENT_MODES: BillPaymentMode[] = ["Cash", "UPI", "Bank_Transfer", "Cheque", "Card", "Other"];

export default function BillDetailDialog({
  billId,
  open,
  onOpenChange,
  onChanged,
}: {
  billId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<BillDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [billNo, setBillNo] = useState("");
  const [billAttachmentUrl, setBillAttachmentUrl] = useState("");
  const [amount, setAmount] = useState("");
  const [gstPercent, setGstPercent] = useState("");

  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState<BillPaymentMode>("Bank_Transfer");
  const [reference, setReference] = useState("");

  function load() {
    fetch(`/api/accounts/bills/${billId}`)
      .then((res) => res.json())
      .then((data: BillDetailRow) => {
        setDetail(data);
        setBillNo(data.bill.billNo);
        setBillAttachmentUrl(data.bill.billAttachmentUrl);
        setAmount(String(data.bill.amount));
        setGstPercent(String(data.bill.gstPercent));
      })
      .catch(() => toast.error(t("Bill load nahi ho payi.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, billId]);

  const isDraft = detail?.bill.status === "Draft";

  async function saveDraft() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/bills/${billId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billNo, billAttachmentUrl, amount: Number(amount), gstPercent: Number(gstPercent) || 0 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Update nahi ho paya."));
        return;
      }
      toast.success(t("Bill save ho gayi."));
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/bills/${billId}/issue`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Issue nahi ho paya."));
        return;
      }
      toast.success(t("Bill Issue ho gayi."));
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    if (!(Number(paymentAmount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/bills/${billId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(paymentAmount), mode: paymentMode, reference }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Payment record nahi ho paya."));
        return;
      }
      toast.success(t("Payment record ho gaya."));
      setPaymentAmount("");
      setReference("");
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
            {billId}
            {detail && (
              <Badge variant={detail.bill.status === "Issued" ? "default" : "secondary"}>
                {detail.bill.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail ? `${detail.bill.vendorName} · PO ${detail.bill.poId}` : t("Details")}
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="rounded-lg border p-3 text-sm">
              <p>
                {t("Bill Amount")}: ₹{detail.bill.amount} ({t("GST included")}: ₹{detail.bill.gstAmount}) ·{" "}
                {t("Paid")}: ₹{detail.totalPaid}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("Vendor Bill No.")}</Label>
                <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} disabled={!isDraft} />
              </div>
              <div className="space-y-2">
                <Label>{t("Amount (GST-inclusive)")}</Label>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={!isDraft}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("GST % (amount ke andar hi included)")}</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                disabled={!isDraft}
              />
            </div>

            {isDraft ? (
              <FileUploadField
                label={t("Bill Document")}
                value={billAttachmentUrl}
                onChange={setBillAttachmentUrl}
              />
            ) : (
              billAttachmentUrl && (
                <a href={billAttachmentUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary underline">
                  {t("Bill Document dekhein")}
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
                {t("Issue ho chuki hai")} — {detail.bill.issuedBy} ·{" "}
                {detail.bill.issuedAt ? new Date(detail.bill.issuedAt).toLocaleString("en-IN") : ""}
              </div>
            )}

            {!isDraft && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{t("Payments")}</p>
                    <p className="text-sm text-muted-foreground">
                      ₹{detail.totalPaid} / ₹{detail.bill.amount}
                    </p>
                  </div>

                  {detail.payments.length > 0 && (
                    <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                      {detail.payments.map((p) => (
                        <div key={p.id} className="flex justify-between rounded-md border px-2 py-1">
                          <span>
                            ₹{p.amount} · {p.mode}
                            {p.reference ? ` · ${p.reference}` : ""}
                          </span>
                          <span>{new Date(p.paidAt).toLocaleDateString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                    <div className="space-y-2">
                      <Label>{t("Amount")}</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("Mode")}</Label>
                      <Select value={paymentMode} onValueChange={(v) => v && setPaymentMode(v as BillPaymentMode)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("Reference")}</Label>
                      <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                    </div>
                    <Button size="sm" disabled={busy || !(Number(paymentAmount) > 0)} onClick={recordPayment}>
                      {t("Payment Record Karein")}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
