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
import { Textarea } from "@/components/ui/textarea";
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
import {
  ORDER_STATUS_LABEL,
  type OrderActivityRow,
  type OrderPaymentRow,
  type OrderRow,
} from "./types";

const PAYMENT_MODES = ["Cash", "UPI", "Bank_Transfer", "Cheque", "Card", "Other"] as const;

export default function OrderDetailDialog({
  orderId,
  open,
  onOpenChange,
  onChanged,
}: {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (order: OrderRow) => void;
}) {
  const t = useT();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [activities, setActivities] = useState<OrderActivityRow[]>([]);
  const [payments, setPayments] = useState<OrderPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/orders/${orderId}`)
      .then((res) => res.json())
      .then((data: { order?: OrderRow; activities?: OrderActivityRow[]; payments?: OrderPaymentRow[] }) => {
        if (data.order) setOrder(data.order);
        setActivities(data.activities ?? []);
        setPayments(data.payments ?? []);
      })
      .catch(() => toast.error(t("Order load nahi ho paya.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId]);

  async function callAction(url: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Update nahi ho paya."));
        return false;
      }
      setOrder(data.order);
      onChanged(data.order);
      load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {orderId}
            {order && <Badge variant="secondary">{t(ORDER_STATUS_LABEL[order.status])}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {order ? `${order.partyName} · ₹${order.orderValue}` : t("Details aur pipeline action")}
          </DialogDescription>
        </DialogHeader>

        {loading || !order ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">{t("Items")}</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Item")}</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">{t("Reserved")}</TableHead>
                      <TableHead className="text-right">{t("Short")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((line) => (
                      <TableRow key={line.lineNo}>
                        <TableCell>
                          <span className="block">{line.itemName}</span>
                          <span className="block text-xs text-muted-foreground">{line.sku}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.qty} {line.uom}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">₹{line.rate}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.reservedQty}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">
                          {line.shortageQty > 0 ? line.shortageQty : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <StageAction order={order} busy={busy} onAction={callAction} />

            <Separator />

            <PaymentSection
              orderId={orderId}
              busy={busy}
              totalPaid={totalPaid}
              orderValue={order.orderValue}
              payments={payments}
              onAction={callAction}
            />

            <Separator />

            <div>
              <p className="mb-2 text-sm font-medium">History</p>
              <div className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {activities.length === 0 && (
                  <p className="text-muted-foreground">{t("Abhi koi activity nahi hai.")}</p>
                )}
                {activities.map((a) => (
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
    </Dialog>
  );
}

function StageAction({
  order,
  busy,
  onAction,
}: {
  order: OrderRow;
  busy: boolean;
  onAction: (url: string, body?: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [dispatchDate, setDispatchDate] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  const canCancel = order.status !== "Ready_For_PDI" && order.status !== "Cancelled";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      {order.status === "Items_Pending" && (
        <p className="text-sm text-muted-foreground">
          {t("Ye order Intake se abhi map ho raha hai.")}
        </p>
      )}

      {order.status === "Payment_Review" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("Payment Review")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Customer ka credit/advance check karke ye Stock_Check ya Credit_Hold me jaayega.")}
          </p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onAction(`/api/orders/${order.id}/payment-review`)}
          >
            {t("Payment Review Chalayein")}
          </Button>
        </div>
      )}

      {order.status === "Credit_Hold" && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-destructive">{t("Credit Hold")}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onAction(`/api/orders/${order.id}/credit-approve`)}
          >
            {t("Approve Karein")}
          </Button>
        </div>
      )}

      {order.status === "Stock_Check" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("Stock Check")}</p>
          <p className="text-xs text-muted-foreground">
            {t("Free FG stock is order ke items ke liye reserve hoga.")}
          </p>
          <Button size="sm" disabled={busy} onClick={() => onAction(`/api/orders/${order.id}/stock-check`)}>
            {t("Stock Check Chalayein")}
          </Button>
        </div>
      )}

      {order.status === "Dispatch_Pending" && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("Dispatch Commit Date")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2">
              <Label>{t("Date")}</Label>
              <Input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={busy || !dispatchDate}
              onClick={() =>
                onAction(`/api/orders/${order.id}/dispatch-commit`, {
                  dispatchCommitDate: new Date(dispatchDate).toISOString(),
                })
              }
            >
              {t("Commit Karein")}
            </Button>
          </div>
        </div>
      )}

      {order.status === "Ready_For_PDI" && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          {t("Ready For PDI — Order FMS ka kaam yahin khatam ho jaata hai.")}
        </div>
      )}

      {order.status === "Cancelled" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {t("Ye order cancel ho chuka hai.")}
        </div>
      )}

      {canCancel && (
        <div className="pt-1">
          {!showCancel ? (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setShowCancel(true)}>
              {t("Order Cancel Karein")}
            </Button>
          ) : (
            <div className="space-y-2">
              <Textarea
                rows={2}
                placeholder={t("Reason (optional)")}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  const ok = await onAction(`/api/orders/${order.id}/cancel`, { reason: cancelReason });
                  if (ok) setShowCancel(false);
                }}
              >
                Confirm
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentSection({
  orderId,
  busy,
  totalPaid,
  orderValue,
  payments,
  onAction,
}: {
  orderId: string;
  busy: boolean;
  totalPaid: number;
  orderValue: number;
  payments: OrderPaymentRow[];
  onAction: (url: string, body?: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof PAYMENT_MODES)[number]>("Bank_Transfer");
  const [reference, setReference] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("Payments")}</p>
        <p className="text-sm text-muted-foreground">
          ₹{totalPaid} / ₹{orderValue}
        </p>
      </div>

      {payments.length > 0 && (
        <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
          {payments.map((p) => (
            <div key={p.id} className="flex justify-between rounded-md border px-2 py-1">
              <span>
                ₹{p.amount} · {p.mode}
                {p.reference ? ` · ${p.reference}` : ""}
              </span>
              <span>{new Date(p.receivedAt).toLocaleDateString("en-IN")}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label>Amount</Label>
          <Input type="number" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Mode</Label>
          <Select value={mode} onValueChange={(v) => v && setMode(v as (typeof PAYMENT_MODES)[number])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("Reference")}</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <Button
          size="sm"
          disabled={busy || !(Number(amount) > 0)}
          onClick={async () => {
            const ok = await onAction(`/api/orders/${orderId}/payment`, {
              amount: Number(amount),
              mode,
              reference,
            });
            if (ok) {
              setAmount("");
              setReference("");
            }
          }}
        >
          {t("Payment Record Karein")}
        </Button>
      </div>
    </div>
  );
}
