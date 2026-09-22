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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ItemPicker, { type PickerItem } from "@/components/item-picker";
import { useT } from "@/components/preferences-provider";
import CustomerPicker, { EMPTY_NEW_CUSTOMER, type NewCustomerDraft } from "./customer-picker";
import type { IntakeCandidate, OrderRow } from "./types";

/**
 * Step 1 for a Lead-sourced candidate: map every quotation line to a real Item, confirm or
 * create the real Customer Master row, and create the Order — all in one submit (see
 * src/lib/orders/orders.ts's createOrderFromQuotation for why this is one atomic action).
 */
export default function IntakeMapDialog({
  candidate,
  open,
  onOpenChange,
  onCreated,
}: {
  candidate: IntakeCandidate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (order: OrderRow) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState("");
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);
  const [mapping, setMapping] = useState<Record<string, PickerItem | null>>({});
  const [transportArrangedBy, setTransportArrangedBy] = useState<"Self" | "Party">("Self");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (mode === "existing" && !selectedId) {
      toast.error(t("Ek Customer chunein."));
      return;
    }
    if (mode === "new" && !newCustomer.customerName.trim()) {
      toast.error(t("Customer ka naam zaroori hai."));
      return;
    }
    const items = candidate.items.map((line) => ({
      lineNo: line.lineNo,
      sku: mapping[line.lineNo]?.sku ?? "",
    }));
    if (items.some((i) => !i.sku)) {
      toast.error(t("Har line ke liye ek Item chunein."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/orders/from-quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationId: candidate.quotationId,
          items,
          transportArrangedBy,
          ...(mode === "existing" ? { customerId: selectedId } : { newCustomer }),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Order ban nahi paya."));
        return;
      }
      toast.success(t("Order ban gaya."));
      onCreated(data.order);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("Quotation")} {candidate.quotationNo} — {t("Order Banayein")}
          </DialogTitle>
          <DialogDescription>
            {t("Har line ko ek real Item se map karein, aur Customer Master confirm ya naya banayein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("Line Items Map Karein")}</p>
            <div className="space-y-3 rounded-lg border p-3">
              {candidate.items.map((line) => (
                <div key={line.lineNo} className="grid gap-2 sm:grid-cols-[1fr_1fr] sm:items-end">
                  <div className="text-sm">
                    <span className="block font-medium">{line.particular || line.description || "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {line.qty} {line.uom} × ₹{line.rate} = ₹{line.amount}
                    </span>
                  </div>
                  <ItemPicker
                    label={t("Item")}
                    value={mapping[line.lineNo] ?? null}
                    onChange={(item) => setMapping((m) => ({ ...m, [line.lineNo]: item }))}
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>{t("Customer")}</Label>
            <CustomerPicker
              mode={mode}
              onModeChange={setMode}
              selectedId={selectedId}
              onSelect={setSelectedId}
              newCustomer={newCustomer}
              onNewCustomerChange={setNewCustomer}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("Transport Arrangement")}</Label>
            <Select
              value={transportArrangedBy}
              onValueChange={(v) => v && setTransportArrangedBy(v as "Self" | "Party")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Self">{t("Self (Hum Arrange Karenge — Freight Paid)")}</SelectItem>
                <SelectItem value="Party">{t("Party (Customer Khud Arrange Karega — To Pay)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Order Banayein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
