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
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { BillCandidateRow, BillRow } from "./types";

/**
 * Creates a Draft bill for one Completed Purchase Order. `amount` is pre-filled from the
 * candidate's own `poValue` (qty * price across every line) but is a normal, editable
 * input — never silently locked, same convention as Receivables' own CreateInvoiceDialog.
 */
export default function CreateBillDialog({
  candidate,
  open,
  onOpenChange,
  onCreated,
}: {
  candidate: BillCandidateRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bill: BillRow) => void;
}) {
  const t = useT();
  const [billNo, setBillNo] = useState("");
  const [billAttachmentUrl, setBillAttachmentUrl] = useState("");
  const [amount, setAmount] = useState(String(candidate.poValue ?? ""));
  const [gstPercent, setGstPercent] = useState(String(candidate.gstPercent ?? 0));
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!(Number(amount) >= 0)) {
      toast.error(t("Amount 0 ya usse zyada honi chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poId: candidate.poId,
          billNo,
          billAttachmentUrl,
          amount: Number(amount),
          gstPercent: Number(gstPercent) || 0,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Bill ban nahi payi."));
        return;
      }
      toast.success(t("Bill (Draft) ban gayi."));
      onOpenChange(false);
      onCreated(data.bill);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Nayi Bill")} — {candidate.poId}
          </DialogTitle>
          <DialogDescription>
            {candidate.vendorName} · ₹{candidate.poValue}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Vendor Bill No. (optional)")}</Label>
              <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Amount (GST-inclusive)")}</Label>
              <Input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("GST % (amount ke andar hi included)")}</Label>
            <Input type="number" step="any" min="0" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} />
          </div>

          <FileUploadField
            label={t("Bill Document (optional yaha, Issue karne se pehle zaroori)")}
            value={billAttachmentUrl}
            onChange={setBillAttachmentUrl}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Bill (Draft) Banayein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
