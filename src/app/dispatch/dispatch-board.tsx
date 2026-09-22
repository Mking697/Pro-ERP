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
import ConfirmDispatchDialog from "./confirm-dispatch-dialog";
import DispatchDetailDialog from "./dispatch-detail-dialog";
import type { DispatchCandidateRow, DispatchListRow } from "./types";

const TABS = [
  { value: "intake", label: "Candidates" },
  { value: "In_Transit", label: "In Transit" },
  { value: "Dispatched", label: "Dispatched" },
  { value: "Delivered", label: "Delivered" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function DispatchBoard() {
  const t = useT();
  const [tab, setTab] = useState<TabValue>("intake");
  const [candidates, setCandidates] = useState<DispatchCandidateRow[]>([]);
  const [rows, setRows] = useState<DispatchListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [confirmCandidate, setConfirmCandidate] = useState<DispatchCandidateRow | null>(null);
  const [openDispatchId, setOpenDispatchId] = useState<string | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  useEffect(() => {
    if (def.value === "intake") {
      fetch("/api/dispatch/intake")
        .then((res) => res.json())
        .then((data: { candidates?: DispatchCandidateRow[] }) => setCandidates(data.candidates ?? []))
        .catch(() => toast.error(t("Dispatch candidates load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    fetch(`/api/dispatch?status=${def.value}`)
      .then((res) => res.json())
      .then((data: { dispatches?: DispatchListRow[] }) => setRows(data.dispatches ?? []))
      .catch(() => toast.error(t("Dispatch list load nahi ho paya.")))
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
              title={t("Abhi koi Dispatch candidate nahi hai")}
              description={t("Shipment Loading Dock par confirm hote hi wo yahan aa jaayegi.")}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shipment</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>{t("Party")}</TableHead>
                    <TableHead>{t("Vehicle")}</TableHead>
                    <TableHead>{t("Invoice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow
                      key={c.shipment.id}
                      className="cursor-pointer"
                      onClick={() => setConfirmCandidate(c)}
                    >
                      <TableCell className="font-medium">{c.shipment.id}</TableCell>
                      <TableCell>{c.order.id}</TableCell>
                      <TableCell>{c.order.partyName}</TableCell>
                      <TableCell>{c.shipment.vehicleNo || c.shipment.vehicleSize || "—"}</TableCell>
                      <TableCell>
                        {c.invoiceIssued ? (
                          <Badge variant="secondary">{t("Issued")}</Badge>
                        ) : (
                          <Badge variant="destructive">{t("Invoice Ka Wait Hai")}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {(["In_Transit", "Dispatched", "Delivered"] as const).map((status) => (
          <TabsContent key={status} value={status} className="mt-4">
            {loading ? (
              <TableSkeleton columns={5} label={t("Load ho raha hai")} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Truck />}
                title={t("Abhi koi shipment nahi hai")}
                description={t("Dispatch confirm hote hi wo yahan aa jaayegi.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Gate Pass")}</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>{t("Party")}</TableHead>
                      <TableHead>{t("Assignee")}</TableHead>
                      <TableHead>{t("Status")}</TableHead>
                      <TableHead>{t("Order Status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenDispatchId(r.id)}>
                        <TableCell className="font-medium">{r.gatePassNo}</TableCell>
                        <TableCell>{r.orderId}</TableCell>
                        <TableCell>{r.partyName}</TableCell>
                        <TableCell>{r.assignedToName || r.assignedTo}</TableCell>
                        <TableCell>
                          {r.status === "Delivered" ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">{t("Delivered")}</Badge>
                          ) : r.status === "Dispatched" ? (
                            <Badge variant="default">{t("Dispatched")}</Badge>
                          ) : (
                            <Badge variant="secondary">{t("In Transit")}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.orderFullyDelivered ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                              {t("Order Poora Deliver Ho Gaya")}
                            </Badge>
                          ) : r.orderFullyDispatched ? (
                            <Badge variant="default">{t("Order Poora Dispatch Ho Gaya")}</Badge>
                          ) : (
                            <Badge variant="outline">{t("Aur Shipments Baaki")}</Badge>
                          )}
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

      {confirmCandidate && (
        <ConfirmDispatchDialog
          key={confirmCandidate.shipment.id}
          candidate={confirmCandidate}
          open={Boolean(confirmCandidate)}
          onOpenChange={(open) => {
            if (!open) setConfirmCandidate(null);
          }}
          onConfirmed={() => setVersion((v) => v + 1)}
        />
      )}

      {openDispatchId && (
        <DispatchDetailDialog
          dispatchId={openDispatchId}
          open={Boolean(openDispatchId)}
          onOpenChange={(open) => {
            if (!open) setOpenDispatchId(null);
          }}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
