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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { PackageSearch, Truck } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import OrderTmsDialog from "./order-tms-dialog";
import TransportVendorsTab from "./transport-vendors-tab";
import type { TmsOrderCandidateRow, TmsShipmentListRow, TmsShipmentStatus } from "./types";

const TABS = [
  { value: "intake", label: "Candidates" },
  { value: "Pending", label: "Pending" },
  { value: "At_Loading_Dock", label: "At Loading Dock" },
  { value: "fully-shipped", label: "Fully Shipped" },
  { value: "vendors", label: "Vendors" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function TmsBoard() {
  const t = useT();
  const [tab, setTab] = useState<TabValue>("intake");
  const [candidates, setCandidates] = useState<TmsOrderCandidateRow[]>([]);
  const [fullyShipped, setFullyShipped] = useState<TmsOrderCandidateRow[]>([]);
  const [shipments, setShipments] = useState<TmsShipmentListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  useEffect(() => {
    if (def.value === "intake") {
      fetch("/api/tms/intake")
        .then((res) => res.json())
        .then((data: { candidates?: TmsOrderCandidateRow[] }) => setCandidates(data.candidates ?? []))
        .catch(() => toast.error(t("Intake candidates load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    if (def.value === "fully-shipped") {
      fetch("/api/tms/fully-shipped")
        .then((res) => res.json())
        .then((data: { orders?: TmsOrderCandidateRow[] }) => setFullyShipped(data.orders ?? []))
        .catch(() => toast.error(t("Fully Shipped orders load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    if (def.value === "vendors") {
      // TransportVendorsTab manages its own loading state — nothing to fetch here.
      return;
    }
    fetch(`/api/tms/shipments?status=${def.value as TmsShipmentStatus}`)
      .then((res) => res.json())
      .then((data: { shipments?: TmsShipmentListRow[] }) => setShipments(data.shipments ?? []))
      .catch(() => toast.error(t("Shipments load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [def, version, t]);

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => v && setTab(v as TabValue)}>
        <TabsList className="flex-wrap">
          {TABS.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value}>
              {t(tb.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="intake" className="mt-4">
          {loading ? (
            <TableSkeleton columns={5} label={t("Load ho raha hai")} />
          ) : candidates.length === 0 ? (
            <EmptyState
              icon={<PackageSearch />}
              title={t("Abhi koi naya TMS candidate nahi hai")}
              description={t("Koi order ki PDI Pass hote hi wo yahan aa jaayega.")}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>{t("Party")}</TableHead>
                    <TableHead className="text-right">{t("Value")}</TableHead>
                    <TableHead>{t("Transport")}</TableHead>
                    <TableHead>{t("Shipment Progress")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow key={c.order.id} className="cursor-pointer" onClick={() => setOpenOrderId(c.order.id)}>
                      <TableCell className="font-medium">{c.order.id}</TableCell>
                      <TableCell>{c.order.partyName}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{c.order.orderValue}</TableCell>
                      <TableCell>
                        {c.needsTransportDecision ? (
                          <Badge variant="destructive">{t("Decision Chahiye")}</Badge>
                        ) : (
                          <Badge variant="secondary">
                            {c.order.transportArrangedBy === "Self" ? t("Self") : t("Party")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.progress.partiallyShipped ? "outline" : "secondary"}>
                          {c.progress.partiallyShipped ? t("Partially Shipped") : t("Not Shipped Yet")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {(["Pending", "At_Loading_Dock"] as const).map((status) => (
          <TabsContent key={status} value={status} className="mt-4">
            {loading ? (
              <TableSkeleton columns={5} label={t("Load ho raha hai")} />
            ) : shipments.length === 0 ? (
              <EmptyState
                icon={<Truck />}
                title={t("Abhi koi shipment nahi hai")}
                description={t("Candidate se shipment plan hote hi wo yahan aa jaayegi.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shipment ID</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>{t("Party")}</TableHead>
                      <TableHead>{t("Vendor")}</TableHead>
                      <TableHead>{t("Vehicle")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipments.map((s) => (
                      <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenOrderId(s.orderId)}>
                        <TableCell className="font-medium">{s.id}</TableCell>
                        <TableCell>{s.orderId}</TableCell>
                        <TableCell>{s.partyName}</TableCell>
                        <TableCell>{s.vendorName || t("Party (Customer)")}</TableCell>
                        <TableCell>{s.vehicleNo || s.vehicleSize || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}

        <TabsContent value="fully-shipped" className="mt-4">
          {loading ? (
            <TableSkeleton columns={3} label={t("Load ho raha hai")} />
          ) : fullyShipped.length === 0 ? (
            <EmptyState
              icon={<Truck />}
              title={t("Abhi koi order poora ship nahi hua")}
              description={t("Jab kisi order ki saari lines ship ho jaayengi, wo yahan dikhega.")}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order ID</TableHead>
                    <TableHead>{t("Party")}</TableHead>
                    <TableHead className="text-right">{t("Value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fullyShipped.map((c) => (
                    <TableRow key={c.order.id} className="cursor-pointer" onClick={() => setOpenOrderId(c.order.id)}>
                      <TableCell className="font-medium">{c.order.id}</TableCell>
                      <TableCell>{c.order.partyName}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{c.order.orderValue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="vendors" className="mt-4">
          <TransportVendorsTab />
        </TabsContent>
      </Tabs>

      {openOrderId && (
        <OrderTmsDialog
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
