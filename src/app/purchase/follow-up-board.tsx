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
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { PhoneCall } from "lucide-react";
import { formatDueDisplay } from "@/lib/formatDate";
import { parseStamp } from "@/lib/timestamp";
import { useT } from "@/components/preferences-provider";
import type { PoOrder } from "./types";

/** Live, never stored — mirrors the same "overdue once the deadline has passed" convention
 * FMS's own step boards use (see src/app/fms/my-steps-board.tsx's isOverdue). */
function isOverdue(dueAt: string): boolean {
  const deadline = parseStamp(dueAt);
  return deadline !== null && new Date() > deadline;
}

/** Step 3 — a real action: the assigned Doer marks it done, optionally with a remark. */
export default function FollowUpBoard() {
  const t = useT();
  const [orders, setOrders] = useState<PoOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [remarkDraft, setRemarkDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/purchase/orders?stage=follow_up")
      .then((res) => res.json())
      .then((data: { orders?: PoOrder[] }) => setOrders(data.orders ?? []))
      .catch(() => toast.error(t("PO list load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  async function markDone(po: PoOrder) {
    setBusyId(po.id);
    try {
      const res = await fetch(`/api/purchase/orders/${po.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark: remarkDraft[po.id] ?? "" }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Follow-up save nahi ho paya."));
        return;
      }

      toast.success(`${po.vendorName} — ${t("Follow-up complete ho gaya.")}`);
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
        icon={<PhoneCall />}
        title={t("Abhi koi Follow-up pending nahi hai")}
        description={t("PO Issue hote hi wo yahan follow-up ke liye aa jaayega.")}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>PO</TableHead>
            <TableHead>{t("Vendor")}</TableHead>
            <TableHead>{t("Items")}</TableHead>
            <TableHead>{t("Due")}</TableHead>
            <TableHead>{t("Remark")}</TableHead>
            <TableHead className="text-right">{t("Action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((po) => {
            const overdue = isOverdue(po.followUpDueAt);
            const busy = busyId === po.id;
            return (
              <TableRow key={po.id}>
                <TableCell className="font-medium">{po.id}</TableCell>
                <TableCell>{po.vendorName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {po.lines.map((l) => l.itemName).join(", ")}
                </TableCell>
                <TableCell>
                  <Badge variant={overdue ? "destructive" : "secondary"}>
                    {formatDueDisplay(po.followUpDueAt)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Input
                    value={remarkDraft[po.id] ?? ""}
                    onChange={(e) => setRemarkDraft((d) => ({ ...d, [po.id]: e.target.value }))}
                    placeholder={t("Jaise: Vendor ne bola X date tak aa jaayega")}
                    className="h-8 min-w-56"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" disabled={busy} onClick={() => markDone(po)}>
                    {t("Follow-up Done")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
