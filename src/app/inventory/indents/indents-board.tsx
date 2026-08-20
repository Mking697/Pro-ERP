"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { formatDueDisplay } from "@/lib/formatDate";
import { qty } from "../types";
import { TableSkeleton } from "@/components/loading-states";
import { useConfirm } from "@/components/confirm-dialog";
import SheetNotConnected from "@/components/sheet-not-connected";

interface Indent {
  Indent_ID: string;
  Timestamp: string;
  SKU: string;
  Item_Name: string;
  Suggested_Qty: string;
  Final_Qty: string;
  UOM: string;
  Reason: string;
  Status: string;
  Received_Qty: string;
}

const STATUS_FILTERS = [
  "Open",
  "Pending",
  "Approved",
  "Partially_Received",
  "Received",
  "Cancelled",
  "All",
] as const;

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Received") return "default";
  if (status === "Cancelled") return "destructive";
  if (status === "Pending") return "secondary";
  return "outline";
}

/**
 * The purchase-request lifecycle: raised, approved, received.
 *
 * Receiving records the arriving quantity here and writes the stock In in the same
 * action — the alternative, marking an indent received and separately keying a stock
 * entry, is the step people forget, and it is how a ledger drifts away from the shelf.
 */
export default function IndentsBoard({
  canApprove,
  canReceive,
}: {
  canApprove: boolean;
  canReceive: boolean;
}) {
  const [indents, setIndents] = useState<Indent[]>([]);
  const confirm = useConfirm();
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("Open");
  const [receiveDraft, setReceiveDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/inventory/indents")
      .then((res) => res.json())
      .then((data: { indents?: Indent[]; setupRequired?: string | null }) => {
        setIndents(data.indents ?? []);
        setSetupRequired(data.setupRequired ?? null);
      })
      .catch(() => toast.error("Indents load nahi ho paye."))
      .finally(() => setLoading(false));
  }, [version]);

  async function act(indent: Indent, action: "approve" | "cancel") {
    setBusyId(indent.Indent_ID);
    try {
      const res = await fetch(`/api/inventory/indents/${indent.Indent_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? "Update nahi ho paya.");
        return;
      }

      toast.success(
        action === "approve"
          ? `${indent.Item_Name} approve ho gaya — ab ye in-transit me ginega.`
          : `${indent.Item_Name} cancel ho gaya.`
      );
      setVersion((v) => v + 1);
    } catch {
      toast.error("Update nahi ho paya.");
    } finally {
      setBusyId(null);
    }
  }

  async function receive(indent: Indent) {
    const quantity = Number(receiveDraft[indent.Indent_ID]);
    if (!(quantity > 0)) {
      toast.error("Received quantity daalein.");
      return;
    }

    setBusyId(indent.Indent_ID);
    try {
      const res = await fetch(`/api/inventory/indents/${indent.Indent_ID}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? "Receive nahi ho paya.");
        return;
      }

      toast.success(
        `${quantity} ${indent.UOM} receive ho gaya — stock me jud gaya.`
      );
      setReceiveDraft((d) => ({ ...d, [indent.Indent_ID]: "" }));
      setVersion((v) => v + 1);
    } catch {
      toast.error("Receive nahi ho paya.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <TableSkeleton columns={6} label="Indents load ho rahe hain" />;
  }

  if (setupRequired) {
    return (
      <SheetNotConnected what={setupRequired} />
    );
  }

  const visible = indents.filter((i) => {
    if (filter === "All") return true;
    // "Open" is what someone actually works from — everything still needing action.
    if (filter === "Open") {
      return ["Pending", "Approved", "Ordered", "Partially_Received"].includes(i.Status);
    }
    return i.Status === filter;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f.replace("_", " ")}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {indents.length === 0
                    ? "Abhi koi indent nahi hai. Reorder page se banayein."
                    : "Is filter par koi indent nahi mila."}
                </TableCell>
              </TableRow>
            )}
            {visible.map((indent) => {
              const ordered = Number(indent.Final_Qty) || 0;
              const received = Number(indent.Received_Qty) || 0;
              const outstanding = ordered - received;
              const canReceiveThis =
                canReceive &&
                ["Approved", "Ordered", "Partially_Received"].includes(indent.Status);
              const busy = busyId === indent.Indent_ID;

              return (
                <TableRow key={indent.Indent_ID}>
                  <TableCell>
                    <Link
                      href={`/inventory/${encodeURIComponent(indent.SKU)}`}
                      className="font-medium hover:underline"
                    >
                      {indent.Item_Name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {indent.SKU} · {indent.Indent_ID}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {indent.Reason.replace("_", " ")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {qty(ordered)}
                    <span className="ml-1 text-xs text-muted-foreground">{indent.UOM}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {received > 0 ? qty(received) : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDueDisplay(indent.Timestamp)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(indent.Status)}>
                      {indent.Status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      {canApprove && indent.Status === "Pending" && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => act(indent, "approve")}>
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              confirm.ask({
                                title: `${indent.Item_Name} ka indent cancel karein?`,
                                description: `${indent.Final_Qty || indent.Suggested_Qty} ${indent.UOM} ki ye purchase request band ho jaayegi. Zaroorat phir bhi rahi to reorder page se nayi banani padegi.`,
                                confirmLabel: "Haan, cancel karein",
                                onConfirm: () => act(indent, "cancel"),
                              })
                            }
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      {canReceiveThis && (
                        <>
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            placeholder={String(qty(outstanding))}
                            value={receiveDraft[indent.Indent_ID] ?? ""}
                            onChange={(e) =>
                              setReceiveDraft((d) => ({
                                ...d,
                                [indent.Indent_ID]: e.target.value,
                              }))
                            }
                            className="h-8 w-24 text-right tabular-nums"
                            aria-label={`${indent.Item_Name} — received quantity`}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => receive(indent)}
                          >
                            Receive
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {confirm.dialog}
    </div>
  );
}
