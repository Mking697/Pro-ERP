"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { FileText } from "lucide-react";
import { useT } from "@/components/preferences-provider";

interface MyPayslip {
  id: string;
  month: string;
  monthlySalary: number;
  daysInMonth: number;
  daysEmployed: number;
  grossPay: number;
  netPay: number;
  pdfUrl: string;
}

function formatMoney(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Every signed-in user's own Finalized payslips — a Draft run's numbers can still
 * change, so it never shows here (see listPayslipsForUser's own comment). */
export default function MyPayslipsBoard() {
  const t = useT();
  const [payslips, setPayslips] = useState<MyPayslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/payroll/my-payslips")
      .then((res) => res.json())
      .then((data: { payslips?: MyPayslip[] }) => setPayslips(data.payslips ?? []))
      .catch(() => toast.error(t("Payslips load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <TableSkeleton columns={5} />;

  if (payslips.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title={t("Abhi tak koi payslip nahi hai.")}
        description={t("Jab Admin aapke month ka payroll run finalize karega, wo yahan dikhega.")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Month")}</TableHead>
          <TableHead>{t("Monthly Salary")}</TableHead>
          <TableHead>{t("Days Employed")}</TableHead>
          <TableHead>{t("Gross Pay")}</TableHead>
          <TableHead>{t("Net Pay")}</TableHead>
          <TableHead>{t("PDF")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payslips.map((p) => (
          <TableRow key={p.id}>
            <TableCell>{p.month}</TableCell>
            <TableCell>{formatMoney(p.monthlySalary)}</TableCell>
            <TableCell>
              <Badge variant="secondary">
                {p.daysEmployed} / {p.daysInMonth}
              </Badge>
            </TableCell>
            <TableCell>{formatMoney(p.grossPay)}</TableCell>
            <TableCell className="font-medium">{formatMoney(p.netPay)}</TableCell>
            <TableCell>
              {p.pdfUrl ? (
                <a
                  href={p.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline"
                >
                  {t("Download")}
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">{t("Nahi bana")}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
