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
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Receipt } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import CreateExpenseDialog from "./create-expense-dialog";
import type { ExpenseEntryRow } from "./types";

/** "Other Payments" — a flat list of one-off Cash/Bank expenses (rent, salary, utilities,
 * misc.), each already posted to the Ledger the moment it's recorded (see
 * src/lib/accounts/expenses.ts). No Draft/Issue step and no detail dialog — simpler
 * records than an Invoice/Bill, so a flat table is enough. */
export default function ExpensesBoard() {
  const t = useT();
  const [entries, setEntries] = useState<ExpenseEntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/accounts/expenses")
      .then((res) => res.json())
      .then((data: { entries?: ExpenseEntryRow[] }) => setEntries(data.entries ?? []))
      .catch(() => toast.error(t("Expenses load nahi ho paye.")))
      .finally(() => setLoading(false));
  }

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateExpenseDialog
          onCreated={() => {
            setLoading(true);
            load();
          }}
        />
      </div>

      {loading ? (
        <TableSkeleton columns={6} label={t("Load ho raha hai")} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={t("Abhi koi Additional Payment nahi hai")}
          description={t("Rent, salary, utilities ya kisi bhi one-off kharch ke liye '+ Naya Expense' dabayein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expense ID</TableHead>
                <TableHead>{t("Category")}</TableHead>
                <TableHead>{t("Paid To")}</TableHead>
                <TableHead>{t("Description")}</TableHead>
                <TableHead className="text-right">{t("Amount")}</TableHead>
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
                  <TableCell>{entry.categoryName}</TableCell>
                  <TableCell>{entry.paidTo || "—"}</TableCell>
                  <TableCell className="max-w-64 truncate">{entry.description || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{entry.amount}</TableCell>
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
