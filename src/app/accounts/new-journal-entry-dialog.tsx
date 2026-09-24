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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import { istDayKey } from "@/lib/timestamp";
import type { ChartOfAccountRow } from "./types";

interface DraftLine {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
}

function emptyLine(key: number): DraftLine {
  return { key, accountId: "", debit: "", credit: "" };
}

/**
 * "+ New Journal Entry" — a manual/adjusting entry, the correction mechanism this Ledger's
 * own comments have described since it was first built ("a correction is its own new,
 * reversing entry") but that had no UI to actually create until now. The running
 * Debit/Credit total shown here is a client-side convenience only — the real balance-or-
 * throw check is `postJournalEntry()`'s own, server-side (see
 * src/lib/accounts/ledger.ts's createManualJournalEntry()).
 */
export default function NewJournalEntryDialog({
  accounts,
  onCreated,
}: {
  accounts: ChartOfAccountRow[];
  onCreated: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(() => istDayKey(new Date()));
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(0), emptyLine(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [saving, setSaving] = useState(false);

  function reset() {
    setDescription("");
    setEntryDate(istDayKey(new Date()));
    setLines([emptyLine(0), emptyLine(1)]);
    setNextKey(2);
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const linesFilled =
    lines.length >= 2 &&
    lines.every((l) => l.accountId && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0));

  async function handleSubmit() {
    if (!description.trim()) {
      toast.error(t("Description zaroori hai."));
      return;
    }
    if (!linesFilled) {
      toast.error(t("Har line me Account aur ek non-zero Debit ya Credit hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/ledger/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          entryDate,
          lines: lines.map((l) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Journal entry nahi ban paya."));
        return;
      }
      toast.success(t("Journal entry post ho gayi."));
      setOpen(false);
      reset();
      onCreated();
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
      <DialogTrigger render={<Button variant="outline">{t("+ New Journal Entry")}</Button>} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Manual Journal Entry")}</DialogTitle>
          <DialogDescription>
            {t("Ek adjusting/correcting entry seedhe Ledger me post karein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-2">
              <Label>{t("Description")}</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Date")}</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">{t("Lines")}</p>
            {lines.map((line, idx) => (
              <div
                key={line.key}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
              >
                <div className="space-y-2">
                  <Label>{t("Account")}</Label>
                  <Select value={line.accountId} onValueChange={(v) => v && updateLine(line.key, { accountId: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("Account chunein")} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Debit</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={line.debit}
                    onChange={(e) => updateLine(line.key, { debit: e.target.value, credit: e.target.value ? "" : line.credit })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Credit</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={line.credit}
                    onChange={(e) => updateLine(line.key, { credit: e.target.value, debit: e.target.value ? "" : line.debit })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Line hatayein")}
                  disabled={lines.length <= 2}
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                >
                  <X />
                </Button>
                {idx === lines.length - 1 && (
                  <div className="sm:col-span-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLines((ls) => [...ls, emptyLine(nextKey)]);
                        setNextKey((k) => k + 1);
                      }}
                    >
                      {t("+ Line Add Karein")}
                    </Button>
                  </div>
                )}
              </div>
            ))}

            <div
              className={`flex justify-between rounded-lg border p-3 text-sm font-medium ${
                balanced ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"
              }`}
            >
              <span>
                {t("Total Debit")}: ₹{totalDebit.toFixed(2)} · {t("Total Credit")}: ₹{totalCredit.toFixed(2)}
              </span>
              <span>{balanced ? t("Balance hai") : t("Balance nahi hai")}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving || !linesFilled}>
            {saving ? "Saving..." : t("Journal Entry Post Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
