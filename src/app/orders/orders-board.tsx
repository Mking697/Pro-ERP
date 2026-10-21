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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { AlertTriangle, ClipboardList, Download, Eye, PackageSearch } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import NewOrderDialog from "./new-order-dialog";
import IntakeMapDialog from "./intake-map-dialog";
import OrderDetailDialog from "./order-detail-dialog";
import SavedViewsBar from "@/components/saved-views-bar";
import { downloadCsvClientSide } from "@/lib/csv-download";
import { ORDER_STATUS_LABEL, type IntakeCandidate, type OrderRow, type OrderStatus, type OrdersFilters } from "./types";

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

// Stable fallback identity for a tab with no loaded data yet — `ordersByTab[tab] ?? []`
// would otherwise hand out a brand-new empty array every render, which defeats any
// useMemo() downstream that depends on `orders` (see selectedOrders below).
const EMPTY_ORDERS: OrderRow[] = [];

// BEGIN bulk status action (pure logic, exercised by isolated tests) -------------------
// Order FMS is a workflow, not a free "pick any status" field (see src/lib/orders/orders.ts
// — each status has exactly one real "advance" action, decided by that status's own gate
// logic, e.g. Payment_Review's outcome depends on the customer's credit check, not on
// anything a user picks). So a bulk status-change control cannot offer a free-form target
// status dropdown; it can only ever offer the ONE advance action that is valid for every
// selected row's CURRENT status (every row must share that same current status), calling
// the exact same single-row endpoint/lib function per row — never a shortcut that bypasses
// that status's own validation. Cancel is the one action valid from ANY non-terminal
// status, so it is offered independently of whether the selection's statuses match.
export interface OrderBulkAdvanceAction {
  key: "payment-review" | "credit-approve" | "stock-check" | "dispatch-commit";
  actionLabel: string;
  path: (orderId: string) => string;
  needsDate?: boolean;
}

const ORDER_NEXT_ACTION: Partial<Record<OrderStatus, OrderBulkAdvanceAction>> = {
  Payment_Review: {
    key: "payment-review",
    actionLabel: "Payment Review Chalayein (auto Stock_Check/Credit_Hold)",
    path: (id) => `/api/orders/${id}/payment-review`,
  },
  Credit_Hold: {
    key: "credit-approve",
    actionLabel: "Credit Hold Approve Karein -> Stock_Check",
    path: (id) => `/api/orders/${id}/credit-approve`,
  },
  Stock_Check: {
    key: "stock-check",
    actionLabel: "Stock Check Chalayein -> Dispatch_Pending",
    path: (id) => `/api/orders/${id}/stock-check`,
  },
  Dispatch_Pending: {
    key: "dispatch-commit",
    actionLabel: "Dispatch Commit Karein -> Ready_For_PDI",
    path: (id) => `/api/orders/${id}/dispatch-commit`,
    needsDate: true,
  },
};

/** Only defined when EVERY selected row shares the same current status AND that status has
 * a real advance action — a mixed-status selection (or one that includes a terminal status)
 * yields nothing bulk-able, rather than silently skipping the rows that don't match. */
export function bulkAdvanceActionFor(selected: OrderRow[]): OrderBulkAdvanceAction | null {
  if (selected.length === 0) return null;
  const statuses = new Set(selected.map((o) => o.status));
  if (statuses.size !== 1) return null;
  const [status] = statuses;
  return ORDER_NEXT_ACTION[status] ?? null;
}

/** Cancel is reachable from any non-terminal status (see cancelOrder()'s own TERMINAL_STATUSES
 * check) — so unlike the advance action above, it doesn't require every selected row to share
 * one current status, only that none of them are already terminal. */
export function bulkCancelAllowed(selected: OrderRow[]): boolean {
  return (
    selected.length > 0 &&
    selected.every((o) => o.status !== "Ready_For_PDI" && o.status !== "Cancelled")
  );
}
// END bulk status action

export default function OrdersBoard() {
  const t = useT();
  const [tab, setTab] = useState("intake");
  const [ordersByTab, setOrdersByTab] = useState<Record<string, OrderRow[]>>({});
  const orders = ordersByTab[tab] ?? EMPTY_ORDERS;
  const [candidates, setCandidates] = useState<IntakeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [mapCandidate, setMapCandidate] = useState<IntakeCandidate | null>(null);

  // Bulk selection — row checkboxes + the selection-count toolbar. Scoped to the current
  // tab's own loaded rows; cleared every time the tab changes or the list is refetched
  // (refresh()/setTabAndRefresh() below), since a stale selected id from a different
  // tab/dataset must never silently carry over into a bulk action on the new one.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkActionKey, setBulkActionKey] = useState(""); // "" | an advance action's key | "cancel"
  const [bulkDispatchDate, setBulkDispatchDate] = useState("");
  const [bulkCancelReason, setBulkCancelReason] = useState("");

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  const selectedOrders = useMemo(
    () => orders.filter((o) => selectedIds.has(o.id)),
    [orders, selectedIds]
  );
  const advanceAction = useMemo(() => bulkAdvanceActionFor(selectedOrders), [selectedOrders]);
  const canBulkCancel = useMemo(() => bulkCancelAllowed(selectedOrders), [selectedOrders]);
  const bulkOptions = [
    ...(advanceAction ? [{ key: advanceAction.key, actionLabel: advanceAction.actionLabel }] : []),
    ...(canBulkCancel ? [{ key: "cancel", actionLabel: "Order Cancel Karein" }] : []),
  ];
  // The Select's own controlled value: if the selection changed shape since the dropdown
  // was last set (e.g. a row was unchecked), fall back to "" rather than keep pointing at
  // an action that is no longer valid for the current selection.
  const effectiveBulkActionKey = bulkOptions.some((o) => o.key === bulkActionKey) ? bulkActionKey : "";

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelectedIds(checked ? new Set(orders.map((o) => o.id)) : new Set());
  }

  function exportSelectedCsv() {
    const header = ["Order ID", "Party", "Source", "Value", "Status", "Created At"];
    const rows: (string | number)[][] = [
      header,
      ...selectedOrders.map((o) => [
        o.id,
        o.partyName,
        o.source,
        o.orderValue,
        ORDER_STATUS_LABEL[o.status],
        new Date(o.createdAt).toLocaleDateString("en-IN"),
      ]),
    ];
    downloadCsvClientSide(`orders-export-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  /** Calls the SAME single-row endpoint the per-order detail dialog already uses, once per
   * selected order (sequential, bounded by the selection size) — never a shortcut that
   * bypasses that endpoint's own tenant-scoped validation/auth just to "batch" the write.
   * Reports real success/failure counts rather than assuming every row succeeded. */
  async function runBulkAdvance() {
    if (!advanceAction) return;
    if (advanceAction.needsDate && !bulkDispatchDate) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const o of selectedOrders) {
      try {
        const res = await fetch(advanceAction.path(o.id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            advanceAction.needsDate
              ? { dispatchCommitDate: new Date(bulkDispatchDate).toISOString() }
              : {}
          ),
        });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setBulkActionKey("");
    setBulkDispatchDate("");
    setSelectedIds(new Set());
    if (fail === 0) toast.success(`${ok} ${t("order(s) advance ho gaye.")}`);
    else toast.error(`${ok} ${t("order(s) advance ho gaye")}, ${fail} ${t("fail ho gaye — dobara koshish karein.")}`);
    refresh();
  }

  async function runBulkCancel() {
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const o of selectedOrders) {
      try {
        const res = await fetch(`/api/orders/${o.id}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: bulkCancelReason }),
        });
        if (res.ok) ok += 1;
        else fail += 1;
      } catch {
        fail += 1;
      }
    }
    setBulkBusy(false);
    setBulkActionKey("");
    setBulkCancelReason("");
    setSelectedIds(new Set());
    if (fail === 0) toast.success(`${ok} ${t("order(s) cancel ho gaye.")}`);
    else toast.error(`${ok} ${t("order(s) cancel ho gaye")}, ${fail} ${t("fail ho gaye.")}`);
    refresh();
  }

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
    // The list about to be refetched may drop/reorder rows entirely — any previously
    // selected id could point at a row that no longer exists in the new result.
    setSelectedIds(new Set());
  }

  // Programmatic tab changes (e.g. applying a saved view) need the same refresh the
  // Tabs component's own onValueChange already triggers below — both go through this
  // one function so the two paths can never drift apart.
  function setTabAndRefresh(nextTab: string) {
    refresh();
    setTab(nextTab);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <SavedViewsBar<OrdersFilters>
          module="orders"
          currentFilters={{ tab }}
          onApply={(filters) => setTabAndRefresh(filters.tab)}
        />
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

      <Tabs value={tab} onValueChange={(v) => { if (v) { setTabAndRefresh(v); } }}>
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
              <div className="space-y-3">
                {selectedOrders.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5">
                    <span className="text-sm font-medium">
                      {selectedOrders.length} {t("order(s) selected")}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={bulkBusy}
                      onClick={() => setSelectedIds(new Set())}
                    >
                      {t("Clear karein")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkBusy}
                      onClick={exportSelectedCsv}
                    >
                      <Download />
                      {t("CSV Export Karein")}
                    </Button>

                    {bulkOptions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={effectiveBulkActionKey}
                          onValueChange={(v) => {
                            if (v) setBulkActionKey(v);
                          }}
                        >
                          <SelectTrigger className="w-auto min-w-48">
                            <SelectValue placeholder={t("Bulk status action chunein")} />
                          </SelectTrigger>
                          <SelectContent>
                            {bulkOptions.map((opt) => (
                              <SelectItem key={opt.key} value={opt.key}>
                                {t(opt.actionLabel)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {effectiveBulkActionKey === advanceAction?.key && (
                          <>
                            {advanceAction.needsDate && (
                              <Input
                                type="date"
                                value={bulkDispatchDate}
                                onChange={(e) => setBulkDispatchDate(e.target.value)}
                                className="h-8 w-auto"
                              />
                            )}
                            <Button
                              size="sm"
                              disabled={bulkBusy || (advanceAction.needsDate && !bulkDispatchDate)}
                              onClick={runBulkAdvance}
                            >
                              {bulkBusy ? t("Apply ho raha hai...") : t("Apply Karein")}
                            </Button>
                          </>
                        )}

                        {effectiveBulkActionKey === "cancel" && (
                          <>
                            <Textarea
                              rows={1}
                              placeholder={t("Reason (optional)")}
                              value={bulkCancelReason}
                              onChange={(e) => setBulkCancelReason(e.target.value)}
                              className="h-8 min-h-8 w-48 resize-none"
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={bulkBusy}
                              onClick={runBulkCancel}
                            >
                              {bulkBusy ? t("Apply ho raha hai...") : t("Sab Cancel Karein")}
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            aria-label={t("Sab select karein")}
                            checked={orders.length > 0 && orders.every((o) => selectedIds.has(o.id))}
                            onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
                          />
                        </TableHead>
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
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={`${o.id} ${t("select karein")}`}
                              checked={selectedIds.has(o.id)}
                              onCheckedChange={(checked) => toggleRow(o.id, Boolean(checked))}
                            />
                          </TableCell>
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
