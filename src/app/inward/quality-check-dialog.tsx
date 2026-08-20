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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { InwardRecord } from "./types";
import { useT } from "@/components/preferences-provider";

export default function QualityCheckDialog({
  entry,
  onVerified,
}: {
  entry: InwardRecord;
  onVerified: (entry: InwardRecord) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [verifyChecked, setVerifyChecked] = useState(false);
  const [passQty, setPassQty] = useState("0");
  const [failQty, setFailQty] = useState("0");
  const [failReason, setFailReason] = useState("");
  const [loading, setLoading] = useState(false);

  const failQtyNumber = Number(failQty) || 0;

  async function handleSave() {
    if (failQtyNumber > 0 && !failReason.trim()) {
      toast.error(t("Fail Qty ho to Fail Reason zaroori hai."));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/inward/${entry.Entry_ID}/quality-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verifyChecked,
          passQty: Number(passQty) || 0,
          failQty: failQtyNumber,
          failReason,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Quality check save nahi ho paya."));
        return;
      }

      toast.success(t("Quality check save ho gaya."));
      onVerified(data.entry);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Quality Check</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry.Party_Name}</DialogTitle>
          <DialogDescription>
            Invoice {entry.Invoice_No} · {entry.Inward_Type}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={verifyChecked}
              onCheckedChange={(checked) => setVerifyChecked(checked === true)}
            />
            Verify material against invoice
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="passQty">IQC Pass Qty</Label>
              <Input
                id="passQty"
                type="number"
                min={0}
                value={passQty}
                onChange={(e) => setPassQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="failQty">IQC Fail Qty</Label>
              <Input
                id="failQty"
                type="number"
                min={0}
                value={failQty}
                onChange={(e) => setFailQty(e.target.value)}
              />
            </div>
          </div>

          {failQtyNumber > 0 && (
            <div className="space-y-2">
              <Label htmlFor="failReason">Fail Reason</Label>
              <Input
                id="failReason"
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                required
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
