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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUploadField from "@/components/file-upload-field";
import BarcodeScanButton from "@/components/barcode-scan-button";
import { isChecklistComplete, matchSkuByScan, uniqueSkus } from "@/lib/scan/match";
import { useT } from "@/components/preferences-provider";
import type { DispatchCandidateRow, UserOption } from "./types";

const TAT_UNITS = ["Minutes", "Hours", "Days"] as const;

/**
 * Step 1 — Confirm Dispatch: issues a Gate Pass, writes the real stock_ledger "Out" for the
 * shipment's own items, and picks an assignee + TAT (computed against that person's own
 * working-hours calendar, same mechanism FMS steps use — see confirmDispatch()'s own header
 * comment in src/lib/dispatch/dispatch.ts). This is the load-bearing action: a bad SKU or
 * genuinely insufficient stock refuses the whole confirm, leaving the shipment untouched.
 */
export default function ConfirmDispatchDialog({
  candidate,
  open,
  onOpenChange,
  onConfirmed,
}: {
  candidate: DispatchCandidateRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => void;
}) {
  const t = useT();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [tatValue, setTatValue] = useState("24");
  const [tatUnit, setTatUnit] = useState<(typeof TAT_UNITS)[number]>("Hours");
  const [gatePassAttachmentUrl, setGatePassAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);
  // Scan-to-verify: every distinct SKU in the shipment must be scanned or manually
  // ticked before Confirm unlocks — catches a wrong-item pick before the Gate Pass
  // (and the real stock_ledger "Out") is issued. Manual ticking stays available for
  // desktops/warehouses with no camera so the flow never gets stuck.
  const requiredSkus = uniqueSkus(candidate.shipment.items.map((i) => i.sku));
  const [verifiedSkus, setVerifiedSkus] = useState<Set<string>>(new Set());
  const allVerified = isChecklistComplete(requiredSkus, verifiedSkus);

  function markVerified(sku: string) {
    setVerifiedSkus((prev) => {
      const next = new Set(prev);
      next.add(sku);
      return next;
    });
  }

  function handleScan(value: string) {
    const matched = matchSkuByScan(requiredSkus, value);
    if (!matched) {
      toast.error(t("Ye SKU is shipment me nahi hai — galat item scan hua."));
      return;
    }
    markVerified(matched);
    toast.success(`${t("Verify ho gaya")}: ${matched}`);
  }

  useEffect(() => {
    fetch("/api/users/directory")
      .then((res) => res.json())
      .then((data: { users?: UserOption[] }) => setUsers(data.users ?? []))
      .catch(() => toast.error(t("Users list load nahi ho payi.")));
    // Runs once per (fresh) mount — the caller remounts this dialog on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    if (!assignedTo) {
      toast.error(t("Assignee chunein."));
      return;
    }
    const value = Number(tatValue);
    if (!(value > 0)) {
      toast.error(t("TAT value 0 se zyada honi chahiye."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/dispatch/shipments/${candidate.shipment.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo, tatValue: value, tatUnit, gatePassAttachmentUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Dispatch confirm nahi ho paya."));
        return;
      }
      toast.success(`${t("Gate Pass issue ho gaya")}: ${data.dispatch.gatePassNo}`);
      onOpenChange(false);
      onConfirmed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Dispatch Confirm Karein")}</DialogTitle>
          <DialogDescription>
            {candidate.order.partyName} · {candidate.shipment.id}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {!candidate.invoiceIssued && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              {t(
                "Is order ka Invoice abhi Issued nahi hai — Confirm Dispatch tab tak nahi ho sakta jab tak Accounts se Invoice Issue na ho jaaye."
              )}
            </div>
          )}

          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t("Shipment Items — Scan Verify")}</p>
              <BarcodeScanButton onScan={handleScan} size="icon-sm" label="" />
            </div>
            <ul className="space-y-1 text-sm">
              {requiredSkus.map((sku) => {
                const line = candidate.shipment.items.find((i) => i.sku === sku);
                const checked = verifiedSkus.has(sku);
                return (
                  <li key={sku} className="flex items-center gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => (v === true ? markVerified(sku) : undefined)}
                      aria-label={`${line?.itemName ?? sku} — ${t("Verify karein")}`}
                    />
                    <span className={checked ? "text-muted-foreground line-through" : ""}>
                      {line?.itemName ?? sku} ({sku}): {line?.qty} {line?.uom}
                    </span>
                  </li>
                );
              })}
            </ul>
            {!allVerified && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("Confirm karne se pehle har item scan ya manually tick karein.")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>{t("Assignee")}</Label>
            <Select value={assignedTo} onValueChange={(v) => v && setAssignedTo(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("User select karein")} />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.userId} value={u.userId}>
                    {u.fullName} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("TAT Value")}</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={tatValue}
                onChange={(e) => setTatValue(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("TAT Unit")}</Label>
              <Select value={tatUnit} onValueChange={(v) => v && setTatUnit(v as (typeof TAT_UNITS)[number])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAT_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <FileUploadField
            label={t("Gate Pass Attachment (optional)")}
            value={gatePassAttachmentUrl}
            onChange={setGatePassAttachmentUrl}
          />
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={saving || !candidate.invoiceIssued || !allVerified}
          >
            {saving ? t("Saving...") : t("Gate Pass Issue Karein — Dispatch Confirm Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
