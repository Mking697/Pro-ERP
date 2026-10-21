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
import { Download } from "lucide-react";
import { useT } from "@/components/preferences-provider";

/**
 * "Export to Tally" — downloads the real General Ledger (Chart of Accounts + posted
 * journal entries, src/lib/accounts/tally.ts) for a chosen date range as Tally-XML.
 *
 * Two files, not one: `serializeTallyExport()` (src/lib/accounts/tally-export.ts) returns
 * masters and vouchers as two independent `<ENVELOPE>` XML documents — they can't be
 * concatenated into a single valid XML file. Masters must be imported into the target
 * Tally company BEFORE vouchers, so this downloads Masters first, then Vouchers, in that
 * order. Read-only — nothing here has been verified against real Tally import behavior.
 */
export default function ExportTallyDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);

  async function downloadPart(part: "masters" | "vouchers") {
    const params = new URLSearchParams({ fromDate, toDate, part });
    const res = await fetch(`/api/accounts/tally-export?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Tally export fail ho gaya.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tally-${part}-${fromDate}-to-${toDate}.xml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExport() {
    if (!fromDate || !toDate) {
      toast.error(t("From aur To date dono zaroori hain."));
      return;
    }
    if (fromDate > toDate) {
      toast.error(t("From date, To date se pehle hona chahiye."));
      return;
    }
    setExporting(true);
    try {
      await downloadPart("masters");
      await downloadPart("vouchers");
      toast.success(t("Masters aur Vouchers XML download ho gaye. Tally me Masters pehle import karein, phir Vouchers."));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Tally export fail ho gaya."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Download className="mr-1.5 h-4 w-4" />
            {t("Export to Tally")}
          </Button>
        }
      />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("Tally Export")}</DialogTitle>
          <DialogDescription>
            {t("Chuni gayi date range ke liye General Ledger ko Tally-compatible XML (Masters + Vouchers) ke roop me download karein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("From")}</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("To")}</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Do files download hongi — Tally me pehle Masters import karein, uske baad Vouchers.")}
          </p>
        </div>

        <DialogFooter>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? t("Export ho raha hai...") : t("Download Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
