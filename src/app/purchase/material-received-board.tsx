"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import FileUploadField from "@/components/file-upload-field";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { PackageCheck } from "lucide-react";
import { qty } from "@/app/inventory/types";
import { useT } from "@/components/preferences-provider";
import type { PoOrder } from "./types";

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "Received") return "default";
  if (status === "Partially_Received") return "outline";
  return "secondary";
}

/** Step 4 — per-line partial/full receiving, reusing the exact same accounting the plain
 * Indents board already uses. Blocked until Step 3 (Follow Up) is marked done. */
export default function MaterialReceivedBoard() {
  const t = useT();
  const [orders, setOrders] = useState<PoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [invoiceDraft, setInvoiceDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/purchase/orders?stage=receiving")
      .then((res) => res.json())
      .then((data: { orders?: PoOrder[] }) => setOrders(data.orders ?? []))
      .catch(() => toast.error(t("PO list load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  async function receive(po: PoOrder, indentId: string) {
    const key = `${po.id}:${indentId}`;
    const quantity = Number(qtyDraft[key]);
    if (!(quantity > 0)) {
      toast.error(t("Received quantity daalein."));
      return;
    }

    setBusyId(key);
    try {
      const res = await fetch(`/api/purchase/orders/${po.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indentId,
          quantity,
          invoiceUrl: invoiceDraft[po.id] || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Receive nahi ho paya."));
        return;
      }

      toast.success(t("Receive ho gaya — stock me jud gaya."));
      setQtyDraft((d) => ({ ...d, [key]: "" }));
      setVersion((v) => v + 1);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <TableSkeleton columns={5} label={t("PO list load ho rahi hai")} />;
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<PackageCheck />}
        title={t("Abhi koi PO receiving ke liye ready nahi hai")}
        description={t("Follow-up complete hote hi PO yahan receiving ke liye aa jaayega.")}
      />
    );
  }

  return (
    <div className="space-y-6">
      {orders.map((po) => (
        <div key={po.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {po.id} · {po.vendorName}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("Lead Time due")}: {po.materialReceivedDueAt ? po.materialReceivedDueAt.slice(0, 10) : "—"}
              </p>
            </div>
            <div className="w-full max-w-xs sm:w-64">
              {po.invoiceUrl ? (
                <a
                  href={po.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline"
                >
                  {t("Invoice dekhein")}
                </a>
              ) : (
                <FileUploadField
                  label={t("Invoice")}
                  value={invoiceDraft[po.id] ?? ""}
                  onChange={(url) => setInvoiceDraft((d) => ({ ...d, [po.id]: url }))}
                />
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Item")}</TableHead>
                  <TableHead className="text-right">{t("Ordered")}</TableHead>
                  <TableHead className="text-right">{t("Received")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">{t("Action")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lines.map((line) => {
                  const received = Number(line.receivedQty) || 0;
                  const outstanding = line.qty - received;
                  const key = `${po.id}:${line.indentId}`;
                  const done = line.indentStatus === "Received";
                  const busy = busyId === key;
                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <span className="block font-medium">{line.itemName}</span>
                        <span className="block text-xs text-muted-foreground">{line.sku}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {qty(line.qty)} {line.uom}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {received > 0 ? qty(received) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(line.indentStatus)}>
                          {line.indentStatus.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {!done && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Input
                              type="number"
                              step="any"
                              min="0"
                              placeholder={String(qty(outstanding))}
                              value={qtyDraft[key] ?? ""}
                              onChange={(e) =>
                                setQtyDraft((d) => ({ ...d, [key]: e.target.value }))
                              }
                              className="h-8 w-24 text-right tabular-nums"
                              aria-label={`${line.itemName} — received quantity`}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => receive(po, line.indentId)}
                            >
                              {t("Receive")}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}
