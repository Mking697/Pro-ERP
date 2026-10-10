"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { AlertTriangle, ClipboardList, Eye, PackageSearch } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import NewOrderDialog from "./new-order-dialog";
import IntakeMapDialog from "./intake-map-dialog";
import OrderDetailDialog from "./order-detail-dialog";
import { ORDER_STATUS_LABEL, type IntakeCandidate, type OrderRow, type OrderStatus } from "./types";

// BEGIN request guard (pure logic, exercised by isolated tests)
class ResponseNotOkError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Request failed with status ${status}`);
    this.name = "ResponseNotOkError";
    this.status = status;
    this.body = body;
  }
}

async function parseJsonResponse<T = unknown>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body (e.g. an HTML error page) — leave body null, status still tells the story.
    }
    throw new ResponseNotOkError(res.status, body);
  }
  return res.json() as Promise<T>;
}

class RequestSequencer {
  private currentId = 0;
  private controller: AbortController | null = null;

  begin(): { id: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.currentId += 1;
    return { id: this.currentId, signal: this.controller.signal };
  }

  isStale(id: number): boolean {
    return id !== this.currentId;
  }

  get activeId(): number {
    return this.currentId;
  }
}

// END request guard

const TABS: { value: string; label: string; status: OrderStatus | "intake" | "all" }[] = [
  { value: "intake", label: "Intake", status: "intake" },
  { value: "Payment_Review", label: "Payment Review", status: "Payment_Review" },
  { value: "Credit_Hold", label: "Credit Hold", status: "Credit_Hold" },
  { value: "Stock_Check", label: "Stock Check", status: "Stock_Check" },
  { value: "Dispatch_Pending", label: "Dispatch Pending", status: "Dispatch_Pending" },
  { value: "Ready_For_PDI", label: "Ready For PDI", status: "Ready_For_PDI" },
  { value: "all", label: "All", status: "all" },
];

function statusVariant(status: OrderStatus): "default" | "secondary" | "destructive" | "outline" | "success" {
  if (status === "Ready_For_PDI") return "success";
  if (status === "Credit_Hold" || status === "Cancelled") return "destructive";
  if (status === "Items_Pending") return "outline";
  return "secondary";
}

export default function OrdersBoard() {
  const t = useT();
  const [tab, setTab] = useState("intake");
  const [ordersByTab, setOrdersByTab] = useState<Record<string, OrderRow[]>>({});
  const orders = ordersByTab[tab] ?? [];
  const [candidates, setCandidates] = useState<IntakeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [mapCandidate, setMapCandidate] = useState<IntakeCandidate | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  // One sequencer for the whole board: a tab switch or a mutation-triggered refetch starts
  // a new request id and aborts whatever the previous tab's own request was still doing —
  // a late-resolving response for an OLD tab is then recognised as stale and ignored instead
  // of overwriting the newer tab's data.
  const sequencerRef = useRef(new RequestSequencer());

  const load = useCallback(() => {
    const { id, signal } = sequencerRef.current.begin();

    function applyIfCurrent<T>(apply: (data: T) => void) {
      return (data: T) => {
        if (sequencerRef.current.isStale(id)) return; // a newer tab/refetch has since started
        apply(data);
        setLoading(false);
      };
    }

    const handleError = (err: unknown) => {
      if (sequencerRef.current.isStale(id)) return;
      if ((err as { name?: string })?.name === "AbortError") return; // superseded on purpose
      // Keep the last known-good data on screen instead of blanking it; surface a real
      // error (distinguishing a 403/500 from "nothing to show") with an explicit retry path.
      const message =
        err instanceof ResponseNotOkError
          ? t("Load nahi ho paya (status {status}).").replace("{status}", String(err.status))
          : t("Load nahi ho paya — network ya server error.");
      setLoadError(message);
      toast.error(message);
      setLoading(false);
    };

    if (def.status === "intake") {
      fetch("/api/orders/intake", { signal })
        .then((res) => parseJsonResponse<{ candidates?: IntakeCandidate[] }>(res))
        .then(applyIfCurrent<{ candidates?: IntakeCandidate[] }>((data) => setCandidates(data.candidates ?? [])))
        .catch(handleError);
      return;
    }
    const url = def.status === "all" ? "/api/orders" : `/api/orders?status=${def.status}`;
    fetch(url, { signal })
      .then((res) => parseJsonResponse<{ orders?: OrderRow[] }>(res))
      .then(applyIfCurrent<{ orders?: OrderRow[] }>((data) => setOrdersByTab((prev) => ({ ...prev, [tab]: data.orders ?? [] }))))
      .catch(handleError);
  }, [def, tab, t]);

  useEffect(() => {
    load();
    const sequencer = sequencerRef.current;
    return () => { sequencer.begin(); };
    // `load` itself changes identity whenever `def`/`t` changes, and `version` is bumped
    // explicitly by mutations below — both are the intended refetch triggers.
  }, [load, version]);

  function refresh() {
    sequencerRef.current.begin();
    setLoading(true);
    setLoadError(null);
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <NewOrderDialog onCreated={refresh} />
      </div>

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {loadError}
          </span>
          <Button size="sm" variant="outline" onClick={refresh}>
            {t("Dobara try karein")}
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => { if (v) { refresh(); setTab(v); } }}>
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
            refresh();
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
          onChanged={refresh}
        />
      )}
    </div>
  );
}
