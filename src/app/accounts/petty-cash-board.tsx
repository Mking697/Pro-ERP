"use client";

import { useEffect, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Wallet } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import TopUpPettyCashDialog from "./top-up-petty-cash-dialog";
import RecordPettyCashExpenseDialog from "./record-petty-cash-expense-dialog";
import type { PettyCashEntryRow } from "./types";

/** Petty Cash Book — the fund's current balance (never stored, derived live from
 * journal_lines — see src/lib/accounts/pettyCash.ts's getPettyCashBalance()), a Top Up and
 * a Record Expense action, and the full entry timeline with a running-balance column. */
export default function PettyCashBoard() {
  const t = useT();
  const [entries, setEntries] = useState<PettyCashEntryRow[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/accounts/petty-cash")
      .then((res) => res.json())
      .then((data: { entries?: PettyCashEntryRow[]; balance?: number }) => {
        setEntries(data.entries ?? []);
        setBalance(data.balance ?? 0);
      })
      .catch(() => toast.error(t("Petty Cash load nahi ho paya.")))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  function refresh() {
    setLoading(true);
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardDescription>{t("Petty Cash — Available Balance")}</CardDescription>
          <CardTitle className="text-3xl tabular-nums">₹{balance}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <TopUpPettyCashDialog onCreated={refresh} />
          <RecordPettyCashExpenseDialog currentBalance={balance} onCreated={refresh} />
        </CardContent>
      </Card>

      {loading ? (
        <TableSkeleton columns={6} label={t("Load ho raha hai")} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Wallet />}
          title={t("Abhi Petty Cash me koi entry nahi hai")}
          description={t("'+ Top Up' se fund me paisa daal kar shuru karein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entry ID</TableHead>
                <TableHead>{t("Type")}</TableHead>
                <TableHead>{t("Counter Account")}</TableHead>
                <TableHead>{t("Description")}</TableHead>
                <TableHead className="text-right">{t("Amount")}</TableHead>
                <TableHead className="text-right">{t("Balance")}</TableHead>
                <TableHead>{t("Date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, i) => (
                <TableRow
                  key={entry.id}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both"
                >
                  <TableCell className="font-medium">{entry.id}</TableCell>
                  <TableCell>
                    <Badge variant={entry.kind === "TopUp" ? "default" : "secondary"}>
                      {entry.kind === "TopUp" ? t("Top Up") : t("Expense")}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.counterAccountName}</TableCell>
                  <TableCell className="max-w-64 truncate">{entry.description || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.kind === "TopUp" ? "+" : "-"}₹{entry.amount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">₹{entry.balanceAfter}</TableCell>
                  <TableCell>{new Date(entry.entryDate).toLocaleDateString("en-IN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
