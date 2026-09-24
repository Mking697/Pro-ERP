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
import type { AccountsOrderRow, CreditNoteRow } from "./types";

/** Applies part or all of a Credit Note's remaining balance to one of the SAME customer's
 * own open orders — becomes a real order_payments row (mode "Credit_Note") on that order,
 * so Order FMS's own credit-gate math sees it exactly like a cash payment. */
export default function ApplyCreditNoteDialog({
  creditNote,
  open,
  onOpenChange,
  onApplied,
}: {
  creditNote: CreditNoteRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (creditNote: CreditNoteRow) => void;
}) {
  const t = useT();
  const [orders, setOrders] = useState<AccountsOrderRow[]>([]);
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState(String(creditNote.remainingBalance));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/accounts/credit-notes/${creditNote.id}`)
      .then((res) => res.json())
      .then((data: { orders?: AccountsOrderRow[] }) => {
        const list = data.orders ?? [];
        setOrders(list);
        setOrderId((current) => current || list[0]?.id || "");
      })
      .catch(() => toast.error(t("Orders load nahi ho paye.")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, creditNote.id]);

  async function handleSubmit() {
    if (!orderId) {
      toast.error(t("Order chunein."));
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/credit-notes/${creditNote.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, amount: Number(amount) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Apply nahi ho paya."));
        return;
      }
      toast.success(t("Credit Note order par apply ho gaya."));
      onOpenChange(false);
      onApplied(data.creditNote);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Credit Note Apply Karein")}</DialogTitle>
          <DialogDescription>
            {creditNote.creditNoteNo} — {t("Available Balance")} ₹{creditNote.remainingBalance}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("Is customer ka koi khula order nahi mila.")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("Order")}</Label>
              <Select value={orderId} onValueChange={(v) => v && setOrderId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Order chunein")} />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.id} — ₹{o.orderValue}
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
                max={creditNote.remainingBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving || loading || orders.length === 0}>
            {saving ? "Saving..." : t("Apply Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
