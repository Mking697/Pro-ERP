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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import type { BillRow, DebitNoteRow } from "./types";

/** Applies part or all of a Debit Note's remaining balance to one of the SAME vendor's own
 * Issued bills — becomes a real bill_payments row (mode "Debit_Note") on that bill,
 * offsetting it exactly like a real payment would. */
export default function ApplyDebitNoteDialog({
  debitNote,
  open,
  onOpenChange,
  onApplied,
}: {
  debitNote: DebitNoteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (debitNote: DebitNoteRow) => void;
}) {
  const t = useT();
  const [bills, setBills] = useState<BillRow[]>([]);
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState(String(debitNote.remainingBalance));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/accounts/debit-notes/${debitNote.id}`)
      .then((res) => res.json())
      .then((data: { bills?: BillRow[] }) => {
        const list = data.bills ?? [];
        setBills(list);
        setBillId((current) => current || list[0]?.id || "");
      })
      .catch(() => toast.error(t("Bills load nahi ho payi.")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debitNote.id]);

  async function handleSubmit() {
    if (!billId) {
      toast.error(t("Bill chunein."));
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/debit-notes/${debitNote.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId, amount: Number(amount) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Apply nahi ho paya."));
        return;
      }
      toast.success(t("Debit Note bill par apply ho gaya."));
      onOpenChange(false);
      onApplied(data.debitNote);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Debit Note Apply Karein")}</DialogTitle>
          <DialogDescription>
            {debitNote.debitNoteNo} — {t("Available Balance")} ₹{debitNote.remainingBalance}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : bills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("Is vendor ki koi Issued bill nahi mili.")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bill</Label>
              <Select value={billId} onValueChange={(v) => v && setBillId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Bill chunein")} />
                </SelectTrigger>
                <SelectContent>
                  {bills.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.id} — ₹{b.amount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving || loading || bills.length === 0}>
            {saving ? "Saving..." : t("Apply Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
