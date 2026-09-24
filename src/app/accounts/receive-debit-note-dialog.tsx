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
import { useT } from "@/components/preferences-provider";
import type { DebitNoteRow } from "./types";

/** Records part or all of a Debit Note's remaining balance as real cash received from the
 * vendor, instead of applying it against a future Bill. */
export default function ReceiveDebitNoteDialog({
  debitNote,
  open,
  onOpenChange,
  onReceived,
}: {
  debitNote: DebitNoteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReceived: (debitNote: DebitNoteRow) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(String(debitNote.remainingBalance));
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/debit-notes/${debitNote.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Receive nahi ho paya."));
        return;
      }
      toast.success(t("Debit Note payment receive ho gaya."));
      onOpenChange(false);
      onReceived(data.debitNote);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setAmount(String(debitNote.remainingBalance));
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Debit Note Payment Receive Karein")}</DialogTitle>
          <DialogDescription>
            {debitNote.debitNoteNo} — {t("Available Balance")} ₹{debitNote.remainingBalance}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{t("Amount")}</Label>
          <Input
            type="number"
            step="any"
            min="0"
            max={debitNote.remainingBalance}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Receive Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
