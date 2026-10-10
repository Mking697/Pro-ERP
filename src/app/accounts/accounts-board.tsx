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
import { AlertTriangle, Eye, FileText, PackageSearch } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import CreateInvoiceDialog from "./create-invoice-dialog";
import InvoiceDetailDialog from "./invoice-detail-dialog";
import type { AccountsOrderRow, InvoiceRow } from "./types";

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

const TABS = [
  { value: "candidates", label: "Needs Invoicing" },
  { value: "Draft", label: "Draft" },
  { value: "Issued", label: "Issued" },
  { value: "all", label: "All" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function AccountsBoard() {
  const t = useT();
  const [tab, setTab] = useState<TabValue>("candidates");
  const [candidates, setCandidates] = useState<AccountsOrderRow[]>([]);
  const [invoicesByTab, setInvoicesByTab] = useState<Record<string, InvoiceRow[]>>({});
  const invoices = invoicesByTab[tab] ?? [];
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [createFor, setCreateFor] = useState<AccountsOrderRow | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  // Only the latest board request may update data or pending/error state.
  const sequencerRef = useRef(new RequestSequencer());

  const load = useCallback(() => {
    const { id, signal } = sequencerRef.current.begin();

    function applyIfCurrent<T>(apply: (data: T) => void) {
      return (data: T) => {
        if (sequencerRef.current.isStale(id)) return;
        apply(data);
        setLoading(false);
      };
    }

    const handleError = (err: unknown) => {
      if (sequencerRef.current.isStale(id)) return;
      if ((err as { name?: string })?.name === "AbortError") return;
      // Retain last known-good data; surface a real, retryable error instead of blanking it.
      const message =
        err instanceof ResponseNotOkError
          ? t("Load nahi ho paya (status {status}).").replace("{status}", String(err.status))
          : t("Load nahi ho paya — network ya server error.");
      setLoadError(message);
      toast.error(message);
      setLoading(false);
    };

    if (def.value === "candidates") {
      fetch("/api/accounts/candidates", { signal })
        .then((res) => parseJsonResponse<{ candidates?: AccountsOrderRow[] }>(res))
        .then(applyIfCurrent<{ candidates?: AccountsOrderRow[] }>((data) => setCandidates(data.candidates ?? [])))
        .catch(handleError);
      return;
    }
    const url = def.value === "all" ? "/api/accounts/invoices" : `/api/accounts/invoices?status=${def.value}`;
    fetch(url, { signal })
      .then((res) => parseJsonResponse<{ invoices?: InvoiceRow[] }>(res))
      .then(applyIfCurrent<{ invoices?: InvoiceRow[] }>((data) => setInvoicesByTab((prev) => ({ ...prev, [tab]: data.invoices ?? [] }))))
      .catch(handleError);
  }, [def, tab, t]);

  useEffect(() => {
    load();
    const sequencer = sequencerRef.current;
    return () => { sequencer.begin(); };
  }, [load, version]);

  function refresh() {
    sequencerRef.current.begin();
    setLoading(true);
    setLoadError(null);
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-4">
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

      <Tabs value={tab} onValueChange={(v) => { if (v) { refresh(); setTab(v as TabValue); } }}>
        <TabsList className="flex-wrap">
          {TABS.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value}>
              {t(tb.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="candidates" className="mt-4">
          {loading ? (
            <TableSkeleton columns={4} label={t("Load ho raha hai")} />
          ) : candidates.length === 0 ? (
            <EmptyState
              icon={<PackageSearch />}
              title={t("Abhi koi naya Invoice candidate nahi hai")}
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
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.id}</TableCell>
                      <TableCell>{o.partyName}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{o.orderValue}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setCreateFor(o)}>
                          {t("Invoice Banayein")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {(["Draft", "Issued", "all"] as const).map((v) => (
          <TabsContent key={v} value={v} className="mt-4">
            {loading ? (
              <TableSkeleton columns={5} label={t("Load ho raha hai")} />
            ) : invoices.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title={t("Abhi koi invoice nahi hai")}
                description={t("Needs Invoicing se ek order chunkar invoice banayein.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>{t("Invoice No.")}</TableHead>
                      <TableHead className="text-right">{t("Final Value")}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv, i) => (
                      <TableRow
                        key={inv.id}
                        style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                        className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both cursor-pointer"
                        onClick={() => setOpenInvoiceId(inv.id)}
                      >
                        <TableCell className="font-medium">{inv.id}</TableCell>
                        <TableCell>{inv.orderId}</TableCell>
                        <TableCell>{inv.invoiceNo || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{inv.finalValue}</TableCell>
                        <TableCell>
                          <Badge variant={inv.status === "Issued" ? "default" : "secondary"}>{inv.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {/* A keyboard-reachable way to open the same detail dialog the row's
                              own onClick already opens for a mouse — a <tr> itself cannot take
                              keyboard focus. */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${inv.id} ke details dekhein`}
                            onClick={() => setOpenInvoiceId(inv.id)}
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

      {createFor && (
        <CreateInvoiceDialog
          order={createFor}
          open={Boolean(createFor)}
          onOpenChange={(open) => {
            if (!open) setCreateFor(null);
          }}
          onCreated={(invoice) => {
            setCreateFor(null);
            refresh();
            setOpenInvoiceId(invoice.id);
          }}
        />
      )}

      {openInvoiceId && (
        <InvoiceDetailDialog
          invoiceId={openInvoiceId}
          open={Boolean(openInvoiceId)}
          onOpenChange={(open) => {
            if (!open) setOpenInvoiceId(null);
          }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
