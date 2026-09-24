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
import { useT } from "@/components/preferences-provider";
import type { AccountType, ChartOfAccountRow } from "./types";

const ACCOUNT_TYPES: AccountType[] = ["Asset", "Liability", "Equity", "Income", "Expense"];

/** "+ Add Account" — a Chart of Accounts row on top of the 14 seeded defaults. Closes the
 * real gap this codebase's own accounting review flagged: until now nothing let an
 * Admin/Accounts holder add one directly. */
export default function AddAccountDialog({ onCreated }: { onCreated: (account: ChartOfAccountRow) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("Asset");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCode("");
    setName("");
    setType("Asset");
  }

  async function handleSubmit() {
    if (!code.trim() || !name.trim()) {
      toast.error(t("Code aur Name dono zaroori hain."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/ledger/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name, type }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Account nahi ban paya."));
        return;
      }
      toast.success(t("Account ban gaya."));
      setOpen(false);
      reset();
      onCreated(data.account);
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
      <DialogTrigger render={<Button variant="outline">{t("+ Add Account")}</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Naya Account")}</DialogTitle>
          <DialogDescription>{t("Chart of Accounts me ek naya account jodein.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6000" />
          </div>
          <div className="space-y-2">
            <Label>{t("Naam")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Type")}</Label>
            <Select value={type} onValueChange={(v) => v && setType(v as AccountType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((tp) => (
                  <SelectItem key={tp} value={tp}>
                    {tp}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Account Banayein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
