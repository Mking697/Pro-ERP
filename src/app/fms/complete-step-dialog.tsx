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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import type { FmsRunRecord } from "./types";

export default function CompleteStepDialog({
  run,
  onCompleted,
}: {
  run: FmsRunRecord;
  onCompleted: () => void;
}) {
  const t = useT();
  const outcomes = (run.Outcome_Options ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState(outcomes[0] ?? "");
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    if (!outcome) {
      toast.error(t("Outcome chunein."));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/fms/steps/${run.Run_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, remark }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Step complete nahi ho paya."));
        return;
      }

      toast.success(t("Step complete ho gaya."));
      onCompleted();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">{t("Complete")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{run.Step_Name}</DialogTitle>
          <DialogDescription>{run.Template_Name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="outcome">Outcome</Label>
            <Select value={outcome} onValueChange={(value) => value && setOutcome(value)}>
              <SelectTrigger id="outcome" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {outcomes.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="remark">{t("Remark (optional)")}</Label>
            <Textarea id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleComplete} disabled={loading || !outcome}>
            {loading ? "Saving..." : t("Complete karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
