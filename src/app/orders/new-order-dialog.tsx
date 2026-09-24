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
import ItemPicker, { type PickerItem } from "@/components/item-picker";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import { computeTotals } from "@/lib/leads/quotationMath";
import CustomerPicker, { EMPTY_NEW_CUSTOMER, type NewCustomerDraft } from "./customer-picker";
import type { OrderRow } from "./types";

interface DraftLine {
  key: number;
  item: PickerItem | null;
  qty: string;
  rate: string;
}

function emptyLine(key: number): DraftLine {
  return { key, item: null, qty: "", rate: "" };
}

/** The Direct entry path — no Lead/Quotation behind it, a salesperson's own Order Form. */
export default function NewOrderDialog({ onCreated }: { onCreated: (order: OrderRow) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState("");
  const [newCustomer, setNewCustomer] = useState<NewCustomerDraft>(EMPTY_NEW_CUSTOMER);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(0)]);
  const [nextKey, setNextKey] = useState(1);
  const [poAttachmentUrl, setPoAttachmentUrl] = useState("");
  const [transportArrangedBy, setTransportArrangedBy] = useState<"Self" | "Party">("Self");
  // Matches orders.gstPercent's own schema default and Quotation Setup's own GST% default —
  // a Direct order used to charge no GST at all (see CLAUDE.md's Accounts section).
  const [gstPercent, setGstPercent] = useState("18");
  const [saving, setSaving] = useState(false);

  function reset() {
    setMode("existing");
    setSelectedId("");
    setNewCustomer(EMPTY_NEW_CUSTOMER);
    setLines([emptyLine(0)]);
    setNextKey(1);
    setPoAttachmentUrl("");
    setTransportArrangedBy("Self");
    setGstPercent("18");
  }

  // No freight concept on a Direct order (unlike a quotation's own computeTotals() call in
  // quotation-builder.tsx, which this mirrors) — passed as 0.
  const totals = computeTotals(
    lines.map((l) => ({ amount: (Number(l.qty) || 0) * (Number(l.rate) || 0) })),
    0,
    Number(gstPercent) || 0
  );

  async function handleSubmit() {
    if (mode === "existing" && !selectedId) {
      toast.error(t("Ek Customer chunein."));
      return;
    }
    if (mode === "new" && !newCustomer.customerName.trim()) {
      toast.error(t("Customer ka naam zaroori hai."));
      return;
    }
    const items = lines
      .filter((l) => l.item)
      .map((l) => ({ sku: l.item!.sku, qty: Number(l.qty) || 0, rate: Number(l.rate) || 0 }));
    if (items.length === 0) {
      toast.error(t("Kam se kam ek item chunein."));
      return;
    }
    if (items.some((i) => !(i.qty > 0))) {
      toast.error(t("Har item ki quantity 0 se zyada honi chahiye."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          poAttachmentUrl,
          transportArrangedBy,
          gstPercent: Number(gstPercent) || 0,
          ...(mode === "existing" ? { customerId: selectedId } : { newCustomer }),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Order ban nahi paya."));
        return;
      }
      toast.success(t("Order ban gaya."));
      setOpen(false);
      reset();
      onCreated(data.order);
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
      <DialogTrigger render={<Button>{t("+ Naya Order")}</Button>} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Naya Order (Direct)")}</DialogTitle>
          <DialogDescription>
            {t("Bina Lead/Quotation ke — seedha Customer aur Items chun kar order banayein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">{t("Items")}</p>
            {lines.map((line, idx) => (
              <div key={line.key} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <ItemPicker
                  label={t("Item")}
                  value={line.item}
                  onChange={(item) =>
                    setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, item } : l)))
                  }
                />
                <div className="space-y-2">
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={line.qty}
                    onChange={(e) =>
                      setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, qty: e.target.value } : l)))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rate</Label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={line.rate}
                    onChange={(e) =>
                      setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, rate: e.target.value } : l)))
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                >
                  {t("Hatayein")}
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
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("GST %")}</Label>
              <Input
                type="number"
                step="any"
                min="0"
                max="100"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{t("Sub Total")}</span>
              <span className="tabular-nums">₹{totals.subTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>
                {t("GST")} {totals.gstPercent}%
              </span>
              <span className="tabular-nums">₹{totals.gst.toFixed(2)}</span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between text-base font-semibold">
              <span>{t("Total")}</span>
              <span className="tabular-nums">₹{totals.payable.toFixed(2)}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
            <FileUploadField
              label={t("PO Attachment (optional)")}
              value={poAttachmentUrl}
              onChange={setPoAttachmentUrl}
            />
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
