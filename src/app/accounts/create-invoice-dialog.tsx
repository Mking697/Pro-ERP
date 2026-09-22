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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { AccountsOrderRow, InvoiceRow, InvoiceSuggestionRow } from "./types";

/**
 * Creates a Draft invoice for one order. `finalValue` is pre-filled from
 * getInvoiceSuggestion() (order value + TMS freight when Self-arranged) but is a normal,
 * editable input — the Doer sees and can adjust the suggestion before saving, it is never
 * silently locked (see CLAUDE.md's Accounts section).
 */
export default function CreateInvoiceDialog({
  order,
  open,
  onOpenChange,
  onCreated,
}: {
  order: AccountsOrderRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (invoice: InvoiceRow) => void;
}) {
  const t = useT();
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceAttachmentUrl, setInvoiceAttachmentUrl] = useState("");
  const [ewayBillNo, setEwayBillNo] = useState("");
  const [ewayBillAttachmentUrl, setEwayBillAttachmentUrl] = useState("");
  const [extraDocumentUrl, setExtraDocumentUrl] = useState("");
  const [finalValue, setFinalValue] = useState("");
  const [suggestion, setSuggestion] = useState<InvoiceSuggestionRow | null>(null);
  const [saving, setSaving] = useState(false);

  // The parent (accounts-board.tsx) only mounts this dialog once an order is picked, and
  // unmounts it on close — so a fresh mount already gives every field its useState default
  // with no reset effect needed; only the suggestion fetch (an async, external read) truly
  // belongs in an effect.
  useEffect(() => {
    fetch(`/api/accounts/suggest/${order.id}`)
      .then((res) => res.json())
      .then((data: InvoiceSuggestionRow) => {
        setSuggestion(data);
        setFinalValue(String(data.suggestedFinalValue ?? ""));
      })
      .catch(() => toast.error(t("Suggested value load nahi ho payi.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  async function handleSubmit() {
    if (!(Number(finalValue) >= 0)) {
      toast.error(t("Final Value 0 ya usse zyada honi chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
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
        toast.error(t(data?.error ?? "Invoice ban nahi payi."));
        return;
      }
      toast.success(t("Invoice (Draft) ban gayi."));
      onOpenChange(false);
      onCreated(data.invoice);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Nayi Invoice")} — {order.id}
          </DialogTitle>
          <DialogDescription>
            {order.partyName} · ₹{order.orderValue}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {suggestion && suggestion.freightTotal > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("Suggested Value")} = {t("Order Value")} ₹{suggestion.orderValue} + {t("TMS Freight")} ₹
              {suggestion.freightTotal} = ₹{suggestion.suggestedFinalValue}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Invoice No. (optional)")}</Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Final Value")}</Label>
              <Input type="number" step="any" min="0" value={finalValue} onChange={(e) => setFinalValue(e.target.value)} />
            </div>
          </div>

          <FileUploadField
            label={t("Invoice Document (optional yaha, Issue karne se pehle zaroori)")}
            value={invoiceAttachmentUrl}
            onChange={setInvoiceAttachmentUrl}
          />

          <div className="space-y-2">
            <Label>{t("E-way Bill No. (optional)")}</Label>
            <Input value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} />
          </div>
          <FileUploadField
            label={t("E-way Bill Document (optional)")}
            value={ewayBillAttachmentUrl}
            onChange={setEwayBillAttachmentUrl}
          />
          <FileUploadField
            label={t("Extra Document (optional)")}
            value={extraDocumentUrl}
            onChange={setExtraDocumentUrl}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Invoice (Draft) Banayein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
