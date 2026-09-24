"use client";

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { CreditNoteRow, CreditNoteReason, InvoiceRow } from "./types";

const REASONS: { value: CreditNoteReason; label: string }[] = [
  { value: "Sales_Return", label: "Sales Return" },
  { value: "Transit_Loss", label: "Transit Loss" },
  { value: "Price_Adjustment", label: "Price Adjustment" },
  { value: "Other", label: "Other" },
];

/**
 * Issues a Credit Note against exactly one Issued invoice — the reverse of that invoice's
 * own value, for a Sales Return, a transit-loss write-off, or a price adjustment. GST is
 * split out proportionally by the server (createCreditNote() in
 * src/lib/accounts/creditNotes.ts); this dialog just collects the amount, a reason, and an
 * optional supporting document.
 */
export default function CreateCreditNoteDialog({
  invoice,
  open,
  onOpenChange,
  onCreated,
}: {
  invoice: InvoiceRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (creditNote: CreditNoteRow) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<CreditNoteReason>("Sales_Return");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setAmount("");
    setReason("Sales_Return");
    setAttachmentUrl("");
  }

  async function handleSubmit() {
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/credit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invoice.id, amount: Number(amount), reason, attachmentUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Credit Note nahi ban paya."));
        return;
      }
      toast.success(t("Credit Note ban gaya."));
      onOpenChange(false);
      reset();
      onCreated(data.creditNote);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Credit Note")}</DialogTitle>
          <DialogDescription>
            {t("Invoiced")} ₹{invoice.finalValue} — {invoice.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Amount")}</Label>
            <Input
              type="number"
              step="any"
              min="0"
              max={invoice.finalValue}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Reason")}</Label>
            <Select value={reason} onValueChange={(v) => v && setReason(v as CreditNoteReason)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FileUploadField
            label={t("Attachment (optional)")}
            value={attachmentUrl}
            onChange={setAttachmentUrl}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Credit Note Issue Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
