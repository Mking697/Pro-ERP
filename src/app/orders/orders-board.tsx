"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { ClipboardList, Eye, PackageSearch } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import NewOrderDialog from "./new-order-dialog";
import IntakeMapDialog from "./intake-map-dialog";
import OrderDetailDialog from "./order-detail-dialog";
import { ORDER_STATUS_LABEL, type IntakeCandidate, type OrderRow, type OrderStatus } from "./types";

const TABS: { value: string; label: string; status: OrderStatus | "intake" | "all" }[] = [
  { value: "intake", label: "Intake", status: "intake" },
  { value: "Payment_Review", label: "Payment Review", status: "Payment_Review" },
  { value: "Credit_Hold", label: "Credit Hold", status: "Credit_Hold" },
  { value: "Stock_Check", label: "Stock Check", status: "Stock_Check" },
  { value: "Dispatch_Pending", label: "Dispatch Pending", status: "Dispatch_Pending" },
  { value: "Ready_For_PDI", label: "Ready For PDI", status: "Ready_For_PDI" },
  { value: "all", label: "All", status: "all" },
];

function statusVariant(status: OrderStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Ready_For_PDI") return "default";
  if (status === "Credit_Hold" || status === "Cancelled") return "destructive";
  if (status === "Items_Pending") return "outline";
  return "secondary";
}

export default function OrdersBoard() {
  const t = useT();
  const [tab, setTab] = useState("intake");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [candidates, setCandidates] = useState<IntakeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [mapCandidate, setMapCandidate] = useState<IntakeCandidate | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  useEffect(() => {
    if (def.status === "intake") {
      fetch("/api/orders/intake")
        .then((res) => res.json())
        .then((data: { candidates?: IntakeCandidate[] }) => setCandidates(data.candidates ?? []))
        .catch(() => toast.error(t("Intake candidates load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    const url = def.status === "all" ? "/api/orders" : `/api/orders?status=${def.status}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { orders?: OrderRow[] }) => setOrders(data.orders ?? []))
      .catch(() => toast.error(t("Orders load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [def, version, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <NewOrderDialog onCreated={() => setVersion((v) => v + 1)} />
      </div>

      <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
        <TabsList className="flex-wrap">
          {TABS.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value}>
              {t(tb.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tb) => (
          <TabsContent key={tb.value} value={tb.value} className="mt-4">
            {loading ? (
              <TableSkeleton columns={5} label={t("Load ho raha hai")} />
            ) : tb.status === "intake" ? (
              candidates.length === 0 ? (
                <EmptyState
                  icon={<PackageSearch />}
                  title={t("Abhi koi naya Order candidate nahi hai")}
                  description={t("Koi Quotation Accept hote hi wo yahan aa jaayega.")}
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Quotation No")}</TableHead>
                        <TableHead>{t("Party")}</TableHead>
                        <TableHead className="text-right">{t("Payable")}</TableHead>
                        <TableHead>{t("Accepted")}</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((c) => (
                        <TableRow
                          key={c.quotationId}
                          className="cursor-pointer"
                          onClick={() => setMapCandidate(c)}
                        >
                          <TableCell className="font-medium">{c.quotationNo}</TableCell>
                          <TableCell>{c.partyName}</TableCell>
                          <TableCell className="text-right tabular-nums">₹{c.payableAmount}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {c.acceptedAt ? new Date(c.acceptedAt).toLocaleDateString("en-IN") : "—"}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => setMapCandidate(c)}>
                              {t("Map Karein")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : orders.length === 0 ? (
              <EmptyState
                icon={<ClipboardList />}
                title={t("Abhi koi order nahi hai")}
                description={t("Direct order banayein ya Intake se ek Quotation map karein.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>{t("Party")}</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">{t("Value")}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{t("Bana")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o, i) => (
                      <TableRow
                        key={o.id}
                        style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                        className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both cursor-pointer"
                        onClick={() => setOpenOrderId(o.id)}
                      >
                        <TableCell className="font-medium">{o.id}</TableCell>
                        <TableCell>{o.partyName}</TableCell>
                        <TableCell>{t(o.source)}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{o.orderValue}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(o.status)}>{t(ORDER_STATUS_LABEL[o.status])}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(o.createdAt).toLocaleDateString("en-IN")}
                        </TableCell>
                        <TableCell>
                          {/* Keyboard-reachable equivalent of the row's own onClick — a
                              <tr> itself cannot take keyboard focus. */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${o.id} ke details dekhein`}
                            onClick={() => setOpenOrderId(o.id)}
                          >
                            <Eye />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {mapCandidate && (
        <IntakeMapDialog
          candidate={mapCandidate}
          open={Boolean(mapCandidate)}
          onOpenChange={(open) => {
            if (!open) setMapCandidate(null);
          }}
          onCreated={(order) => {
            setMapCandidate(null);
            setVersion((v) => v + 1);
            setOpenOrderId(order.id);
          }}
        />
      )}

      {openOrderId && (
        <OrderDetailDialog
          orderId={openOrderId}
          open={Boolean(openOrderId)}
          onOpenChange={(open) => {
            if (!open) setOpenOrderId(null);
          }}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
