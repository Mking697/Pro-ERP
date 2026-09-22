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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { BookOpen } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import type {
  BalanceSheetRow,
  ChartOfAccountRow,
  ProfitAndLossRow,
  TrialBalanceRow,
} from "./types";

const SUB_TABS = [
  { value: "accounts", label: "Chart of Accounts" },
  { value: "trial-balance", label: "Trial Balance" },
  { value: "pnl", label: "P&L" },
  { value: "balance-sheet", label: "Balance Sheet" },
] as const;

type SubTab = (typeof SUB_TABS)[number]["value"];

/**
 * Chart of Accounts + the three live-computed reports (Trial Balance, P&L, Balance Sheet)
 * — every number here is read fresh from journal_lines on every load, nothing is stored.
 * Plain tables, no charting library, matching this build's own "lower-risk" instruction.
 */
export default function LedgerBoard() {
  const t = useT();
  const [subTab, setSubTab] = useState<SubTab>("accounts");

  const [accounts, setAccounts] = useState<ChartOfAccountRow[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [pnl, setPnl] = useState<ProfitAndLossRow | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [asOf, setAsOf] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [from, to]);

  useEffect(() => {
    if (subTab === "accounts") {
      fetch("/api/accounts/ledger/accounts")
        .then((res) => res.json())
        .then((data: { accounts?: ChartOfAccountRow[] }) => setAccounts(data.accounts ?? []))
        .catch(() => toast.error(t("Chart of Accounts load nahi ho paya.")))
        .finally(() => setLoading(false));
      return;
    }
    if (subTab === "trial-balance") {
      fetch(`/api/accounts/ledger/trial-balance${query ? `?${query}` : ""}`)
        .then((res) => res.json())
        .then((data: { rows?: TrialBalanceRow[] }) => setTrialBalance(data.rows ?? []))
        .catch(() => toast.error(t("Trial Balance load nahi ho payi.")))
        .finally(() => setLoading(false));
      return;
    }
    if (subTab === "pnl") {
      fetch(`/api/accounts/ledger/pnl${query ? `?${query}` : ""}`)
        .then((res) => res.json())
        .then((data: ProfitAndLossRow) => setPnl(data))
        .catch(() => toast.error(t("P&L load nahi ho paya.")))
        .finally(() => setLoading(false));
      return;
    }
    const params = new URLSearchParams();
    if (asOf) params.set("asOf", asOf);
    fetch(`/api/accounts/ledger/balance-sheet${params.toString() ? `?${params.toString()}` : ""}`)
      .then((res) => res.json())
      .then((data: BalanceSheetRow) => setBalanceSheet(data))
      .catch(() => toast.error(t("Balance Sheet load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [subTab, query, asOf, t]);

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={(v) => v && setSubTab(v as SubTab)}>
        <TabsList className="flex-wrap">
          {SUB_TABS.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value}>
              {t(tb.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="accounts" className="mt-4">
          {loading ? (
            <TableSkeleton columns={4} label={t("Load ho raha hai")} />
          ) : accounts.length === 0 ? (
            <EmptyState icon={<BookOpen />} title={t("Koi account nahi mila")} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>{t("Naam")}</TableHead>
                    <TableHead>{t("Type")}</TableHead>
                    <TableHead>System</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-mono text-xs">{a.code}</TableCell>
                      <TableCell>{a.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{a.type}</Badge>
                      </TableCell>
                      <TableCell>{a.isSystem ? t("Haan") : t("Nahi")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="trial-balance" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="space-y-2">
              <Label>{t("From (optional)")}</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("To (optional)")}</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {loading ? (
            <TableSkeleton columns={4} label={t("Load ho raha hai")} />
          ) : trialBalance.length === 0 ? (
            <EmptyState icon={<BookOpen />} title={t("Is range me koi entry nahi hai")} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>{t("Naam")}</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trialBalance.map((r) => (
                    <TableRow key={r.accountId}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{r.debit}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{r.credit}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell colSpan={2}>{t("Total")}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      ₹{trialBalance.reduce((s, r) => s + r.debit, 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ₹{trialBalance.reduce((s, r) => s + r.credit, 0).toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="pnl" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="space-y-2">
              <Label>{t("From (optional)")}</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("To (optional)")}</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          {loading || !pnl ? (
            <TableSkeleton columns={2} label={t("Load ho raha hai")} />
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead colSpan={2}>{t("Income")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pnl.income.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{r.amount}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>{t("Total Income")}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{pnl.totalIncome}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead colSpan={2}>{t("Expense")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pnl.expense.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{r.amount}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>{t("Total Expense")}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{pnl.totalExpense}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="rounded-lg border p-3 text-sm font-medium">
                {t("Net Profit")}: ₹{pnl.netProfit}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="balance-sheet" className="mt-4 space-y-4">
          <div className="sm:max-w-xs space-y-2">
            <Label>{t("As of (optional, khaali chhodne par aaj tak)")}</Label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          {loading || !balanceSheet ? (
            <TableSkeleton columns={2} label={t("Load ho raha hai")} />
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead colSpan={2}>Assets</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceSheet.assets.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{r.amount}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>{t("Total Assets")}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{balanceSheet.totalAssets}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead colSpan={2}>Liabilities</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceSheet.liabilities.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{r.amount}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>{t("Total Liabilities")}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{balanceSheet.totalLiabilities}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead colSpan={2}>Equity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balanceSheet.equity.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums">₹{r.amount}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>{t("Total Equity")}</TableCell>
                      <TableCell className="text-right tabular-nums">₹{balanceSheet.totalEquity}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
