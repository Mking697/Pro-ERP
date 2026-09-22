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
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/components/preferences-provider";
import PlanShipmentDialog from "./plan-shipment-dialog";
import type { TmsOrderDetailRow, TmsShipmentRow } from "./types";

export default function OrderTmsDialog({
  orderId,
  open,
  onOpenChange,
  onChanged,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<TmsOrderDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [transportChoice, setTransportChoice] = useState<"Self" | "Party">("Self");
  const [planOpen, setPlanOpen] = useState(false);
  // Bumped every time the Plan dialog is opened, and passed as PlanShipmentDialog's own
  // `key` below — forces a fresh mount each time rather than that dialog resetting its own
  // fields via an effect (see its own header comment for why).
  const [planSession, setPlanSession] = useState(0);

  function load() {
    fetch(`/api/tms/orders/${orderId}`)
      .then((res) => res.json())
      .then((data: TmsOrderDetailRow) => setDetail(data))
      .catch(() => toast.error(t("Order TMS details load nahi ho paye.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  async function setTransportArrangement() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tms/orders/${orderId}/transport-arrangement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transportArrangedBy: transportChoice }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Update nahi ho paya."));
        return;
      }
      toast.success(t("Transport arrangement set ho gaya."));
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {orderId}
            {detail?.order.transportArrangedBy && (
              <Badge variant="secondary">
                {detail.order.transportArrangedBy === "Self" ? t("Self (Freight Paid)") : t("Party (To Pay)")}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail ? `${detail.order.partyName} · ₹${detail.order.orderValue}` : t("Details aur shipment actions")}
          </DialogDescription>
        </DialogHeader>

        {loading || !detail ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-4">
            {!detail.order.transportArrangedBy && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-sm font-medium">{t("Transport Arrangement Set Karein")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("Ye order transport arrangement (Self/Party) set hue bina bana tha — pehle wo decide karein.")}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <Select value={transportChoice} onValueChange={(v) => v && setTransportChoice(v as "Self" | "Party")}>
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Self">{t("Self (Hum Arrange Karenge — Freight Paid)")}</SelectItem>
                      <SelectItem value="Party">{t("Party (Customer Khud Arrange Karega — To Pay)")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={busy} onClick={setTransportArrangement}>
                    {t("Set Karein")}
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">{t("Shipment Progress")}</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Item")}</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">{t("Shipped")}</TableHead>
                      <TableHead className="text-right">{t("Baaki")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.progress.lines.map((l) => (
                      <TableRow key={l.sku}>
                        <TableCell>
                          <span className="block">{l.itemName}</span>
                          <span className="block text-xs text-muted-foreground">{l.sku}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.qty} {l.uom}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.shippedQty}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.remainingQty > 0 ? l.remainingQty : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {detail.order.transportArrangedBy && !detail.progress.fullyShipped && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      setPlanSession((s) => s + 1);
                      setPlanOpen(true);
                    }}
                  >
                    {t("+ Naya Shipment Plan Karein")}
                  </Button>
                </div>
              )}
              {detail.progress.fullyShipped && (
                <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2 text-sm">
                  {t("Ye order poora ship ho chuka hai.")}
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">{t("Shipments")}</p>
              {detail.shipments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("Abhi koi shipment plan nahi hui hai.")}</p>
              ) : (
                <div className="space-y-3">
                  {detail.shipments.map((s) => (
                    <ShipmentCard key={s.id} shipment={s} busy={busy} setBusy={setBusy} onChanged={() => { load(); onChanged(); }} />
                  ))}
                </div>
              )}
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-sm font-medium">History</p>
              <div className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {detail.activities.length === 0 && (
                  <p className="text-muted-foreground">{t("Abhi koi activity nahi hai.")}</p>
                )}
                {detail.activities.map((a) => (
                  <div key={a.id} className="rounded-md border p-2">
                    <p>{a.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>

      {detail && (
        <PlanShipmentDialog
          key={planSession}
          order={detail.order}
          lines={detail.progress.lines}
          open={planOpen}
          onOpenChange={setPlanOpen}
          onPlanned={() => {
            load();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
}

function ShipmentCard({
  shipment,
  busy,
  setBusy,
  onChanged,
}: {
  shipment: TmsShipmentRow;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [followUpNote, setFollowUpNote] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [vehicleNo, setVehicleNo] = useState(shipment.vehicleNo);
  const [driverContactNo, setDriverContactNo] = useState(shipment.driverContactNo);

  async function followUp() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tms/shipments/${shipment.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: followUpNote }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Follow-up nahi ho paya."));
        return;
      }
      toast.success(t("Follow-up log ho gaya."));
      setFollowUpNote("");
      setShowFollowUp(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tms/shipments/${shipment.id}/confirm-loading-dock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleNo, driverContactNo }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Confirm nahi ho paya."));
        return;
      }
      toast.success(t("Loading Dock confirm ho gaya."));
      setShowConfirm(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{shipment.id}</span>{" "}
          <Badge variant={shipment.status === "At_Loading_Dock" ? "default" : "secondary"}>
            {shipment.status === "At_Loading_Dock" ? t("At Loading Dock") : "Pending"}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(shipment.createdAt).toLocaleDateString("en-IN")}
        </span>
      </div>

      {shipment.vendorName && (
        <p className="text-xs text-muted-foreground">
          {shipment.vendorName} · {shipment.vehicleSize} · ₹{shipment.vehiclePrice}
        </p>
      )}
      {(shipment.fromWarehouse || shipment.toAddress) && (
        <p className="text-xs text-muted-foreground">
          {shipment.fromWarehouse || "—"} → {shipment.toAddress || "—"}
        </p>
      )}
      {(shipment.vehicleNo || shipment.driverContactNo) && (
        <p className="text-xs text-muted-foreground">
          {t("Vehicle")}: {shipment.vehicleNo || "—"} · {t("Driver")}: {shipment.driverContactNo || "—"}
        </p>
      )}

      <ul className="list-inside list-disc text-xs text-muted-foreground">
        {shipment.items.map((i) => (
          <li key={i.lineNo}>
            {i.itemName}: {i.qty} {i.uom}
          </li>
        ))}
      </ul>

      {shipment.status === "Pending" && (
        <div className="flex flex-wrap gap-2 pt-1">
          {!showFollowUp && (
            <Button size="sm" variant="outline" onClick={() => setShowFollowUp(true)}>
              {t("Follow Up")}
            </Button>
          )}
          {!showConfirm && (
            <Button size="sm" onClick={() => setShowConfirm(true)}>
              {t("Loading Dock Confirm Karein")}
            </Button>
          )}
        </div>
      )}

      {showFollowUp && (
        <div className="space-y-2 rounded-md border p-2">
          <Input
            placeholder={t("Note (optional)")}
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
          />
          <Button size="sm" disabled={busy} onClick={followUp}>
            {t("Follow-up Log Karein")}
          </Button>
        </div>
      )}

      {showConfirm && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("Vehicle No.")}</Label>
              <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Driver Contact No.")}</Label>
              <Input value={driverContactNo} onChange={(e) => setDriverContactNo(e.target.value)} />
            </div>
          </div>
          <Button size="sm" disabled={busy} onClick={confirm}>
            {t("Confirm Karein")}
          </Button>
        </div>
      )}

      {shipment.status === "At_Loading_Dock" && (
        <p className="text-xs text-muted-foreground">
          {t("Loading Dock confirm kiya")}: {shipment.loadingDockConfirmedBy} ·{" "}
          {shipment.loadingDockConfirmedAt ? new Date(shipment.loadingDockConfirmedAt).toLocaleString("en-IN") : ""}
        </p>
      )}
    </div>
  );
}
