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
import CreateBillDialog from "./create-bill-dialog";
import BillDetailDialog from "./bill-detail-dialog";
import type { BillCandidateRow, BillRow } from "./types";

const TABS = [
  { value: "candidates", label: "Needs Billing" },
  { value: "Draft", label: "Draft" },
  { value: "Issued", label: "Issued" },
  { value: "all", label: "All" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

/** The Payables mirror of accounts-board.tsx's own Receivables board — a Completed
 * Purchase Order with no Bill yet is this board's own intake candidate, exactly like a
 * Passed-PDI order with no Invoice yet is Receivables'. */
export default function PayablesBoard() {
  const t = useT();
  const [tab, setTab] = useState<TabValue>("candidates");
  const [candidates, setCandidates] = useState<BillCandidateRow[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [createFor, setCreateFor] = useState<BillCandidateRow | null>(null);
  const [openBillId, setOpenBillId] = useState<string | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  useEffect(() => {
    if (def.value === "candidates") {
      fetch("/api/accounts/bills/candidates")
        .then((res) => res.json())
        .then((data: { candidates?: BillCandidateRow[] }) => setCandidates(data.candidates ?? []))
        .catch(() => toast.error(t("Intake candidates load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    const url = def.value === "all" ? "/api/accounts/bills" : `/api/accounts/bills?status=${def.value}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { bills?: BillRow[] }) => setBills(data.bills ?? []))
      .catch(() => toast.error(t("Bills load nahi ho payi.")))
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
              title={t("Abhi koi naya Bill candidate nahi hai")}
              description={t("Koi Purchase Order Material Received (Completed) hote hi wo yahan aa jaayega.")}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO ID</TableHead>
                    <TableHead>{t("Vendor")}</TableHead>
                    <TableHead className="text-right">{t("PO Value")}</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow key={c.poId}>
                      <TableCell className="font-medium">{c.poId}</TableCell>
                      <TableCell>{c.vendorName}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{c.poValue}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setCreateFor(c)}>
                          {t("Bill Banayein")}
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
            ) : bills.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title={t("Abhi koi bill nahi hai")}
                description={t("Needs Billing se ek PO chunkar bill banayein.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill ID</TableHead>
                      <TableHead>PO</TableHead>
                      <TableHead>{t("Vendor")}</TableHead>
                      <TableHead className="text-right">{t("Amount")}</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bills.map((b, i) => (
                      <TableRow
                        key={b.id}
                        style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                        className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both cursor-pointer"
                        onClick={() => setOpenBillId(b.id)}
                      >
                        <TableCell className="font-medium">{b.id}</TableCell>
                        <TableCell>{b.poId}</TableCell>
                        <TableCell>{b.vendorName}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{b.amount}</TableCell>
                        <TableCell>
                          <Badge variant={b.status === "Issued" ? "default" : "secondary"}>{b.status}</Badge>
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
        <CreateBillDialog
          candidate={createFor}
          open={Boolean(createFor)}
          onOpenChange={(open) => {
            if (!open) setCreateFor(null);
          }}
          onCreated={(bill) => {
            setCreateFor(null);
            setVersion((v) => v + 1);
            setOpenBillId(bill.id);
          }}
        />
      )}

      {openBillId && (
        <BillDetailDialog
          billId={openBillId}
          open={Boolean(openBillId)}
          onOpenChange={(open) => {
            if (!open) setOpenBillId(null);
          }}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
