"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Eye, FileText } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import WalkInQuotationDialog from "./walk-in-quotation-dialog";
import type { QuotationRow, QuotationStatus } from "./types";

function statusVariant(status: QuotationStatus): "success" | "secondary" | "destructive" | "outline" {
  if (status === "Accepted") return "success";
  if (status === "Rejected" || status === "Expired") return "destructive";
  if (status === "Draft") return "outline";
  return "secondary";
}

/** Every quotation for the org — lead-linked and walk-in alike. A lead-linked one is also
 * reachable from that lead's own detail dialog; this is the one place a walk-in quotation
 * (no Lead behind it) is visible at all. */
export default function QuotationsBoard() {
  const t = useT();
  const router = useRouter();
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/leads/quotations")
      .then((res) => res.json())
      .then((data: { quotations?: QuotationRow[] }) => setQuotations(data.quotations ?? []))
      .catch(() => toast.error(t("Quotations load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter(
      (row) =>
        row.quotationNo.toLowerCase().includes(q) || row.partyName.toLowerCase().includes(q)
    );
  }, [quotations, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("Quotation No ya Customer naam se search karein...")}
          aria-label={t("Quotation No ya Customer naam se search karein")}
          className="h-9 max-w-xs"
        />
        <div className="ml-auto">
          <WalkInQuotationDialog />
        </div>
      </div>

      {loading ? (
        <TableSkeleton columns={5} label={t("Quotations load ho rahi hain")} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={
            quotations.length === 0
              ? t("Abhi koi Quotation nahi hai")
              : t("Is search se koi Quotation nahi mili")
          }
          description={t("Kisi Lead ko Negotiation stage me le jaakar, ya seedha 'Nayi Quotation' se banayein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Quotation No")}</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">{t("Payable")}</TableHead>
                <TableHead>{t("Bani")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((q, i) => (
                <TableRow
                  key={q.id}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both cursor-pointer"
                  onClick={() => router.push(`/leads/quotations/${q.id}`)}
                >
                  <TableCell className="font-medium">{q.quotationNo}</TableCell>
                  <TableCell>
                    {q.partyName}
                    {!q.leadId && (
                      <span className="ml-2 text-xs text-muted-foreground">({t("walk-in")})</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(q.status)}>{q.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{q.payableAmount.toFixed(2)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(q.createdAt).toLocaleDateString("en-IN")}
                  </TableCell>
                  <TableCell>
                    {/* Keyboard-reachable equivalent of the row's own onClick — a <tr>
                        itself cannot take keyboard focus. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${q.quotationNo} ke details dekhein`}
                      onClick={() => router.push(`/leads/quotations/${q.id}`)}
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
    </div>
  );
}
