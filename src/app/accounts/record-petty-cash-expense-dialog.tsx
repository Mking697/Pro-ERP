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
  DialogTrigger,
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
import type { ChartOfAccountRow, PettyCashEntryRow } from "./types";

/** Record Expense — money moving OUT of the Petty Cash fund against an Expense category.
 * The API (recordPettyCashExpense() in src/lib/accounts/pettyCash.ts) refuses this if
 * `amount` exceeds the fund's own current balance — a petty cash fund can't pay out more
 * than it holds — so the error from that check surfaces here like any other save error. */
export default function RecordPettyCashExpenseDialog({
  currentBalance,
  onCreated,
}: {
  currentBalance: number;
  onCreated: (entry: PettyCashEntryRow) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<ChartOfAccountRow[]>([]);
  const [categoryAccountId, setCategoryAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/accounts/ledger/accounts")
      .then((res) => res.json())
      .then((data: { accounts?: ChartOfAccountRow[] }) => {
        const expenseAccounts = (data.accounts ?? []).filter((a) => a.type === "Expense");
        setCategories(expenseAccounts);
        setCategoryAccountId((current) => current || expenseAccounts[0]?.id || "");
      })
      .catch(() => toast.error(t("Expense categories load nahi ho payin.")));
  }, [open, t]);

  function reset() {
    setCategoryAccountId("");
    setDescription("");
    setAmount("");
    setAttachmentUrl("");
  }

  async function handleSubmit() {
    if (!categoryAccountId) {
      toast.error(t("Category chunein."));
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/petty-cash/expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryAccountId, description, amount: Number(amount), attachmentUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Expense record nahi ho paya."));
        return;
      }
      toast.success(t("Petty Cash se Expense record ho gaya."));
      setOpen(false);
      reset();
      onCreated(data.entry);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger render={<Button>{t("+ Record Expense")}</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Petty Cash Expense")}</DialogTitle>
          <DialogDescription>
            {t("Available Balance")}: ₹{currentBalance}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Category")}</Label>
            <Select value={categoryAccountId} onValueChange={(v) => v && setCategoryAccountId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("Category chunein")} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Amount")}</Label>
            <Input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Description")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <FileUploadField
            label={t("Attachment (optional)")}
            value={attachmentUrl}
            onChange={setAttachmentUrl}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Expense Record Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
