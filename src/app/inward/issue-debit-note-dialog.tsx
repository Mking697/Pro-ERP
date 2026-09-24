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
import VendorPicker from "@/components/vendor-picker";
import { useT } from "@/components/preferences-provider";

type DebitNoteReason = "IQC_Fail" | "Other";

const REASONS: { value: DebitNoteReason; label: string }[] = [
  { value: "IQC_Fail", label: "IQC Fail" },
  { value: "Other", label: "Other" },
];

interface CreatedDebitNote {
  id: string;
  debitNoteNo: string;
}

/**
 * Issues a Debit Note against a vendor for a Failure Log entry — a claim the org wants the
 * vendor to compensate, independent of "Accept Under Deviation" (an entry can get either,
 * both, or neither). `amount` is manually entered in full — no vendor-price
 * auto-suggestion, per explicit product decision (unlike Purchase's own PO-issue screen).
 *
 * Unlike an inward entry's own free-text Party_Name, a Debit Note needs a REAL vendor row
 * to post against (createDebitNote() refuses otherwise) — so submit stays disabled until
 * `vendorId` is actually set, whether that came pre-filled from the linked inward entry or
 * from picking one here.
 */
export default function IssueDebitNoteDialog({
  failureLogId,
  linkedVendorId,
  partyName,
  open,
  onOpenChange,
  onCreated,
}: {
  failureLogId: string;
  linkedVendorId: string;
  partyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (debitNote: CreatedDebitNote) => void;
}) {
  const t = useT();
  const [vendorName, setVendorName] = useState(partyName);
  const [vendorId, setVendorId] = useState(linkedVendorId);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<DebitNoteReason>("IQC_Fail");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setVendorName(partyName);
    setVendorId(linkedVendorId);
    setAmount("");
    setReason("IQC_Fail");
    setAttachmentUrl("");
  }

  async function handleSubmit() {
    if (!vendorId) {
      toast.error(t("Ek registered vendor chunein — Vendor Master me se."));
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/debit-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          amount: Number(amount),
          reason,
          linkedFailureLogId: failureLogId,
          attachmentUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Debit Note nahi ban paya."));
        return;
      }
      toast.success(t("Debit Note ban gaya."));
      onOpenChange(false);
      reset();
      onCreated(data.debitNote);
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
          <DialogTitle>{t("Debit Note")}</DialogTitle>
          <DialogDescription>{t("Vendor se defective goods ka compensation claim karein.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <VendorPicker name={vendorName} vendorId={vendorId} onChange={(n, v) => { setVendorName(n); setVendorId(v); }} required />

          <div className="space-y-2">
            <Label>{t("Amount")}</Label>
            <Input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Reason")}</Label>
            <Select value={reason} onValueChange={(v) => v && setReason(v as DebitNoteReason)}>
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
            {saving ? "Saving..." : t("Debit Note Issue Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
