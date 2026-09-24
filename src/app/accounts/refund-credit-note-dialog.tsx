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
import type { CreditNoteRow } from "./types";

/** Pays out part or all of a Credit Note's remaining balance in real cash instead of
 * applying it to a future order. */
export default function RefundCreditNoteDialog({
  creditNote,
  open,
  onOpenChange,
  onRefunded,
}: {
  creditNote: CreditNoteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefunded: (creditNote: CreditNoteRow) => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(String(creditNote.remainingBalance));
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/credit-notes/${creditNote.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Refund nahi ho paya."));
        return;
      }
      toast.success(t("Credit Note refund ho gaya."));
      onOpenChange(false);
      onRefunded(data.creditNote);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setAmount(String(creditNote.remainingBalance));
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Credit Note Refund Karein")}</DialogTitle>
          <DialogDescription>
            {creditNote.creditNoteNo} — {t("Available Balance")} ₹{creditNote.remainingBalance}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>{t("Amount")}</Label>
          <Input
            type="number"
            step="any"
            min="0"
            max={creditNote.remainingBalance}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Refund Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
