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
import { ClipboardCheck, PackageSearch } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import PdiDetailDialog from "./pdi-detail-dialog";
import { PDI_STATUS_LABEL, type PdiInspectionRow, type PdiOrderRow, type PdiStatus } from "./types";

const TABS: { value: string; label: string; status: PdiStatus | "intake" | "all" }[] = [
  { value: "intake", label: "Intake", status: "intake" },
  { value: "Pending", label: "Pending", status: "Pending" },
  { value: "Passed", label: "Passed", status: "Passed" },
  { value: "all", label: "All", status: "all" },
];

function isOverdue(dueAt: string, status: PdiStatus): boolean {
  if (status !== "Pending" || !dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

export default function PdiBoard() {
  const t = useT();
  const [tab, setTab] = useState("intake");
  const [inspections, setInspections] = useState<PdiInspectionRow[]>([]);
  const [candidates, setCandidates] = useState<PdiOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [openPdiId, setOpenPdiId] = useState<string | null>(null);
  const [punchingId, setPunchingId] = useState<string | null>(null);

  const def = useMemo(() => TABS.find((tb) => tb.value === tab) ?? TABS[0], [tab]);

  useEffect(() => {
    if (def.status === "intake") {
      fetch("/api/pdi/intake")
        .then((res) => res.json())
        .then((data: { candidates?: PdiOrderRow[] }) => setCandidates(data.candidates ?? []))
        .catch(() => toast.error(t("Intake candidates load nahi ho paye.")))
        .finally(() => setLoading(false));
      return;
    }
    const url = def.status === "all" ? "/api/pdi" : `/api/pdi?status=${def.status}`;
    fetch(url)
      .then((res) => res.json())
      .then((data: { inspections?: PdiInspectionRow[] }) => setInspections(data.inspections ?? []))
      .catch(() => toast.error(t("PDI list load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [def, version, t]);

  async function punch(orderId: string) {
    setPunchingId(orderId);
    try {
      const res = await fetch("/api/pdi/from-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "PDI nahi ban payi."));
        return;
      }
      toast.success(t("PDI shuru ho gayi."));
      setVersion((v) => v + 1);
      setTab("Pending");
      setOpenPdiId(data.inspection.id);
    } finally {
      setPunchingId(null);
    }
  }

  return (
    <div className="space-y-4">
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
                  title={t("Abhi koi naya PDI candidate nahi hai")}
                  description={t("Koi order Ready For PDI hote hi wo yahan aa jaayega.")}
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order ID</TableHead>
                        <TableHead>{t("Party")}</TableHead>
                        <TableHead className="text-right">{t("Value")}</TableHead>
                        <TableHead>{t("Dispatch Commit")}</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((c) => {
                        const waiting = c.items.some((l) => l.shortageQty > 0);
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.id}</TableCell>
                            <TableCell>{c.partyName}</TableCell>
                            <TableCell className="text-right tabular-nums">₹{c.orderValue}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {c.dispatchCommitDate
                                ? new Date(c.dispatchCommitDate).toLocaleDateString("en-IN")
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={punchingId === c.id}
                                onClick={() => punch(c.id)}
                              >
                                {waiting ? t("PDI Shuru Karein (Waiting)") : t("PDI Shuru Karein")}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : inspections.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck />}
                title={t("Abhi koi PDI inspection nahi hai")}
                description={t("Intake se koi order punch hote hi wo yahan aa jaayega.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PDI ID</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>{t("Party")}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{t("Due")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspections.map((p, i) => {
                      const overdue = isOverdue(p.dueAt, p.status);
                      return (
                        <TableRow
                          key={p.id}
                          style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                          className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both cursor-pointer"
                          onClick={() => setOpenPdiId(p.id)}
                        >
                          <TableCell className="font-medium">{p.id}</TableCell>
                          <TableCell>{p.orderId}</TableCell>
                          <TableCell>{p.order.partyName}</TableCell>
                          <TableCell className="flex flex-wrap items-center gap-1.5">
                            <Badge variant={p.status === "Passed" ? "default" : "secondary"}>
                              {t(PDI_STATUS_LABEL[p.status])}
                            </Badge>
                            {p.status === "Pending" && (
                              <Badge variant={p.waitingForStock ? "outline" : "secondary"}>
                                {p.waitingForStock ? t("Waiting for Stock") : t("Ready to Inspect")}
                              </Badge>
                            )}
                            {overdue && <Badge variant="destructive">{t("Overdue")}</Badge>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.dueAt ? new Date(p.dueAt).toLocaleDateString("en-IN") : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {openPdiId && (
        <PdiDetailDialog
          pdiId={openPdiId}
          open={Boolean(openPdiId)}
          onOpenChange={(open) => {
            if (!open) setOpenPdiId(null);
          }}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
