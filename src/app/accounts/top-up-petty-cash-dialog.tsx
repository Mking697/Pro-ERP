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
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import type { PettyCashEntryRow } from "./types";

/** Top Up — money moving INTO the Petty Cash fund, normally from Cash/Bank. Deliberately
 * no source-account picker in this UI (the API defaults to Cash/Bank when none is given,
 * see topUpPettyCash() in src/lib/accounts/pettyCash.ts) — the ordinary path is always
 * "top up from Cash/Bank"; a different source is a rare enough case to not need a UI slot
 * yet. */
export default function TopUpPettyCashDialog({ onCreated }: { onCreated: (entry: PettyCashEntryRow) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setAmount("");
    setDescription("");
    setAttachmentUrl("");
  }

  async function handleSubmit() {
    if (!(Number(amount) > 0)) {
      toast.error(t("Amount 0 se zyada hona chahiye."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/accounts/petty-cash/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), description, attachmentUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Top Up nahi ho paya."));
        return;
      }
      toast.success(t("Petty Cash Top Up ho gaya."));
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
      <DialogTrigger render={<Button variant="outline">{t("+ Top Up")}</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Petty Cash Top Up")}</DialogTitle>
          <DialogDescription>{t("Cash/Bank se Petty Cash fund me paisa daalein.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            {saving ? "Saving..." : t("Top Up Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
