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
import { FileText, PackageSearch } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import CreateInvoiceDialog from "./create-invoice-dialog";
import InvoiceDetailDialog from "./invoice-detail-dialog";
import type { AccountsOrderRow, InvoiceRow } from "./types";

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
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [createFor, setCreateFor] = useState<AccountsOrderRow | null>(null);
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  useEffect(() => {
    if (def.value === "candidates") {
      fetch("/api/accounts/candidates")
        .then((res) => res.json())
        .then((data: { candidates?: AccountsOrderRow[] }) => setCandidates(data.candidates ?? []))
        .catch(() => toast.error(t("Intake candidates load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    const url = def.value === "all" ? "/api/accounts/invoices" : `/api/accounts/invoices?status=${def.value}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { invoices?: InvoiceRow[] }) => setInvoices(data.invoices ?? []))
      .catch(() => toast.error(t("Invoices load nahi ho payi.")))
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
            setVersion((v) => v + 1);
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
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
