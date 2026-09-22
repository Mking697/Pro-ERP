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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import type { TmsLineProgress, TmsOrderRow, TransportVendorRow } from "./types";

/**
 * Plans one shipment against an order still not fully shipped. One form for both branches
 * (Self/Party — see src/lib/tms/tms.ts's planShipment() for why this is one function, and
 * why this dialog mirrors it as one form rather than two): Self additionally asks for
 * Vendor/Vehicle Size/Freight, Party skips straight to line allocation.
 *
 * JUDGMENT CALL: every remaining line is pre-filled at its FULL remaining quantity when the
 * dialog opens (for both Self and Party), editable down for a partial shipment — the spec
 * explicitly asked for this default on the Party side ("expecting the whole order in one
 * go"), and the same default is a reasonable, harmless convenience on the Self side too
 * (see CLAUDE.md's TMS section for this exact call, spelled out).
 *
 * The caller (order-tms-dialog.tsx) remounts this component fresh on every open (a `key`
 * that changes each time "+ Plan Shipment" is clicked) rather than this component resetting
 * its own fields via a `useEffect` keyed on `open` — lazy `useState` initializers read
 * `order`/`lines` once, at that fresh mount, which is simpler and avoids a react-hooks
 * lint warning against synchronous setState calls inside an effect body.
 */
export default function PlanShipmentDialog({
  order,
  lines,
  open,
  onOpenChange,
  onPlanned,
}: {
  order: TmsOrderRow;
  lines: TmsLineProgress[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlanned: () => void;
}) {
  const t = useT();
  const isSelf = order.transportArrangedBy === "Self";
  const remainingLines = lines.filter((l) => l.remainingQty > 0);

  const [vendors, setVendors] = useState<TransportVendorRow[]>([]);
  const [transportVendorId, setTransportVendorId] = useState("");
  const [vehicleSize, setVehicleSize] = useState("");
  const [vehiclePrice, setVehiclePrice] = useState("");
  const [fromWarehouse, setFromWarehouse] = useState("");
  const [toAddress, setToAddress] = useState(() =>
    [order.shippingAddress, order.shippingCity, order.shippingState].filter(Boolean).join(", ")
  );
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverContactNo, setDriverContactNo] = useState("");
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>(() =>
    Object.fromEntries(remainingLines.map((l) => [l.sku, String(l.remainingQty)]))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSelf) return;
    fetch("/api/tms/vendors")
      .then((res) => res.json())
      .then((data: { vendors?: TransportVendorRow[] }) =>
        setVendors((data.vendors ?? []).filter((v) => v.Status === "Active"))
      )
      .catch(() => toast.error(t("Transport Vendors load nahi ho paye.")));
    // Runs once per (fresh) mount — see this component's own header comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    const items = remainingLines
      .map((l) => ({ sku: l.sku, qty: Number(qtyByLine[l.sku] ?? 0) }))
      .filter((l) => l.qty > 0);
    if (items.length === 0) {
      toast.error(t("Kam se kam ek line allocate karein."));
      return;
    }
    if (isSelf && !transportVendorId) {
      toast.error(t("Transport Vendor chunein."));
      return;
    }
    if (isSelf && !vehicleSize.trim()) {
      toast.error(t("Vehicle Size dein."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/tms/orders/${order.id}/shipments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          fromWarehouse,
          toAddress,
          vehicleNo,
          driverContactNo,
          ...(isSelf
            ? { transportVendorId, vehicleSize, vehiclePrice: Number(vehiclePrice) || 0 }
            : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Shipment ban nahi paya."));
        return;
      }
      toast.success(t("Shipment plan ho gaya."));
      onOpenChange(false);
      onPlanned();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Naya Shipment Plan Karein")}</DialogTitle>
          <DialogDescription>
            {isSelf
              ? t("Vehicle/vendor chunein aur jo lines is truck me jaa rahi hain unki quantity dein.")
              : t("Customer khud pickup arrange kar raha hai — jo lines is pickup me jaa rahi hain unki quantity dein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {isSelf && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("Transport Vendor")}</Label>
                <Select value={transportVendorId} onValueChange={(v) => v && setTransportVendorId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Chunein")} />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => (
                      <SelectItem key={v.Vendor_ID} value={v.Vendor_ID}>
                        {v.Vendor_Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Vehicle Size")}</Label>
                <Input value={vehicleSize} onChange={(e) => setVehicleSize(e.target.value)} placeholder="e.g. 32ft SXL" />
              </div>
              <div className="space-y-2">
                <Label>{t("Vehicle Price (Freight)")}</Label>
                <Input type="number" step="any" min="0" value={vehiclePrice} onChange={(e) => setVehiclePrice(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("From Warehouse")}</Label>
              <Input value={fromWarehouse} onChange={(e) => setFromWarehouse(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("To Address")}</Label>
              <Input value={toAddress} onChange={(e) => setToAddress(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Vehicle No. (optional)")}</Label>
              <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Driver Contact No. (optional)")}</Label>
              <Input value={driverContactNo} onChange={(e) => setDriverContactNo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("Line Allocation")}</p>
            <div className="space-y-2 rounded-lg border p-3">
              {remainingLines.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("Koi line baaki nahi hai.")}</p>
              )}
              {remainingLines.map((l) => (
                <div key={l.sku} className="grid grid-cols-[1fr_auto] items-center gap-2">
                  <div className="text-sm">
                    <span className="block font-medium">{l.itemName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("Baaki")}: {l.remainingQty} {l.uom}
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max={l.remainingQty}
                    className="w-28"
                    value={qtyByLine[l.sku] ?? ""}
                    onChange={(e) => setQtyByLine((m) => ({ ...m, [l.sku]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Shipment Plan Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
