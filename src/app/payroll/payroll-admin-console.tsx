"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { FileText, Users, AlertTriangle } from "lucide-react";
import { useT } from "@/components/preferences-provider";

interface UserSalaryInfo {
  userId: string;
  fullName: string;
  role: string;
  status: string;
  currentSalary: number | null;
  effectiveFrom: string | null;
}

interface PayrollRun {
  id: string;
  month: string;
  status: "Draft" | "Finalized";
  generatedBy: string;
  generatedAt: string;
  finalizedBy: string;
  finalizedAt: string | null;
}

interface RunPayslip {
  id: string;
  userId: string;
  userFullName: string;
  monthlySalary: number;
  daysInMonth: number;
  daysEmployed: number;
  grossPay: number;
  pfEmployee: number;
  esiEmployee: number;
  tds: number;
  netPay: number;
  pdfUrl: string;
  /** Persisted amount of computed PF/ESI/TDS that could not be withheld this period.
   * Optional only for compatibility with older API responses that omit the field. */
  deductionShortfall?: number;
}

function resolveDeductionShortfall(
  payslip: Pick<RunPayslip, "userId" | "deductionShortfall">,
  shortfallByUserId: Record<string, number>,
): number {
  // Only an omitted/undefined field may use the compatibility Generate cache.
  // A present invalid value must not resurrect a stale shortfall warning.
  const value = payslip.deductionShortfall === undefined
    ? shortfallByUserId[payslip.userId]
    : payslip.deductionShortfall;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function formatMoney(amount: number): string {
  return `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Set/raise a user's salary — a raise mints a new salary_structures row rather than
 * mutating the old one, so past months keep resolving against whatever was actually in
 * effect then. */
function SetSalaryDialog({
  user,
  onSaved,
}: {
  user: UserSalaryInfo;
  onSaved: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [monthlySalary, setMonthlySalary] = useState(String(user.currentSalary ?? ""));
  const [effectiveFrom, setEffectiveFrom] = useState(todayDateOnly());
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/payroll/salary-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.userId, monthlySalary, effectiveFrom }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Salary set nahi ho payi."));
        return;
      }
      toast.success(t("Salary set ho gayi."));
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">{t("Salary set karein")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.fullName}</DialogTitle>
          <DialogDescription>
            {t("Naya monthly salary ek nayi row ke roop me save hota hai — purane months ka payroll purani salary se hi calculate hota rahega.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="monthlySalary">{t("Monthly Salary")}</Label>
            <Input
              id="monthlySalary"
              type="number"
              step="any"
              min="0"
              value={monthlySalary}
              onChange={(e) => setMonthlySalary(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="effectiveFrom">{t("Effective From")}</Label>
            <Input
              id="effectiveFrom"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : t("Save karein")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SalaryStructuresCard() {
  const t = useT();
  const [users, setUsers] = useState<UserSalaryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/payroll/salary-structure")
      .then((res) => res.json())
      .then((data: { users?: UserSalaryInfo[] }) => setUsers(data.users ?? []))
      .catch(() => toast.error(t("Salary structures load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Salary Structures")}</CardTitle>
        <CardDescription>
          {t("Har user ki current monthly salary. Ek raise nayi effective date se lagu hoti hai.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton columns={4} />
        ) : users.length === 0 ? (
          <EmptyState icon={<Users />} title={t("Koi user nahi mila.")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("User")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead>{t("Current Salary")}</TableHead>
                <TableHead>{t("Effective From")}</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  <TableCell>
                    <Badge variant={u.status === "Active" ? "secondary" : "outline"}>
                      {t(u.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.currentSalary !== null ? formatMoney(u.currentSalary) : t("Set nahi hai")}
                  </TableCell>
                  <TableCell>{u.effectiveFrom ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <SetSalaryDialog user={u} onSaved={() => setVersion((v) => v + 1)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Shows persisted payslip shortfalls after reload. Generate state is a compatibility
 * fallback only when an older API response omits deductionShortfall. */
function RunPayslipsDialog({
  run,
  shortfallByUserId,
}: {
  run: PayrollRun;
  shortfallByUserId: Record<string, number>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<RunPayslip[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/payroll/runs/${run.id}`)
      .then((res) => res.json())
      .then((data: { payslips?: RunPayslip[] }) => setPayslips(data.payslips ?? []))
      .catch(() => toast.error(t("Payslips load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [open, run.id, t]);

  const anyShortfall = payslips.some((p) => resolveDeductionShortfall(p, shortfallByUserId) > 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline">{t("Payslips dekhein")}</Button>} />
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {run.month} — {t(run.status)}
          </DialogTitle>
          <DialogDescription>
            {run.status === "Finalized"
              ? t("Ye run Finalized hai — iske payslips ab fixed hain.")
              : t("Ye run abhi Draft hai — dobara Generate karne par ye payslips replace ho jaayenge.")}
          </DialogDescription>
        </DialogHeader>
        {anyShortfall && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t(
                "Kuch employees ke liye computed PF/ESI/TDS unki is period ki gross pay se zyada tha — jo withhold nahi ho paya, wo neeche 'Shortfall' column me dikh raha hai. Ye statutory filing nahi hai — apne accountant/CA se confirm karein ki ye recover kaise hoga."
              )}
            </span>
          </div>
        )}
        {loading ? (
          <TableSkeleton columns={7} />
        ) : payslips.length === 0 ? (
          <EmptyState icon={<FileText />} title={t("Is run me koi payslip nahi hai.")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("User")}</TableHead>
                <TableHead>{t("Days Employed")}</TableHead>
                <TableHead>{t("Gross Pay")}</TableHead>
                <TableHead>{t("Deductions")}</TableHead>
                <TableHead>{t("Shortfall")}</TableHead>
                <TableHead>{t("Net Pay")}</TableHead>
                <TableHead>{t("PDF")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payslips.map((p) => {
                const shortfall = resolveDeductionShortfall(p, shortfallByUserId);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.userFullName}</TableCell>
                    <TableCell>
                      {p.daysEmployed} / {p.daysInMonth}
                    </TableCell>
                    <TableCell>{formatMoney(p.grossPay)}</TableCell>
                    <TableCell>
                      {p.pfEmployee + p.esiEmployee + p.tds > 0
                        ? formatMoney(p.pfEmployee + p.esiEmployee + p.tds)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {shortfall > 0 ? (
                        <Badge variant="destructive">{formatMoney(shortfall)}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{formatMoney(p.netPay)}</TableCell>
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
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PayrollRunsCard() {
  const t = useT();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [generating, setGenerating] = useState(false);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // runId -> userId -> deductionShortfall from Generate, retained for older API responses.
  // This cache resets on reload; persisted GET payslip values are authoritative.
  const [shortfallsByRun, setShortfallsByRun] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    fetch("/api/payroll/runs")
      .then((res) => res.json())
      .then((data: { runs?: PayrollRun[] }) => setRuns(data.runs ?? []))
      .catch(() => toast.error(t("Payroll runs load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  const monthOptions = useMemo(() => {
    const now = new Date();
    const options: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return options;
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Payroll run generate nahi ho paya."));
        return;
      }
      // Retain Generate shortfalls for compatibility when a GET response omits the field;
      // the dialog always prefers its loaded payslip's persisted value, including zero.
      const runId: string | undefined = data?.run?.id;
      const payslips: { userId: string; deductionShortfall?: number }[] = data?.payslips ?? [];
      if (runId) {
        const byUser: Record<string, number> = {};
        for (const p of payslips) {
          if (typeof p.deductionShortfall === "number" && Number.isFinite(p.deductionShortfall) && p.deductionShortfall > 0) {
            byUser[p.userId] = p.deductionShortfall;
          }
        }
        setShortfallsByRun((prev) => ({ ...prev, [runId]: byUser }));
        const shortfallCount = Object.keys(byUser).length;
        if (shortfallCount > 0) {
          toast.warning(
            t(
              `${shortfallCount} employee(s) ke liye deduction shortfall hua — kam gross pay ke karan PF/ESI/TDS poora withhold nahi ho paya. "Payslips dekhein" me "Shortfall" column check karein.`
            )
          );
        } else {
          toast.success(t("Payroll run generate ho gaya."));
        }
      } else {
        toast.success(t("Payroll run generate ho gaya."));
      }
      setVersion((v) => v + 1);
    } finally {
      setGenerating(false);
    }
  }

  async function handleFinalize(runId: string) {
    setFinalizingId(runId);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/finalize`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Finalize nahi ho paya."));
        return;
      }
      toast.success(t("Payroll run Finalize ho gaya. Payslip PDFs ban rahe hain."));
      setVersion((v) => v + 1);
    } finally {
      setFinalizingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Payroll Runs")}</CardTitle>
        <CardDescription>
          {t("Ek month select karke Generate karein — Draft run dobara Generate karne par replace ho jaata hai. Finalize karne ke baad wo permanent record ban jaata hai aur payslip PDFs bante hain.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>{t("Month")}</Label>
            <Select value={month} onValueChange={(v) => v && setMonth(v)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : t("Generate karein")}
          </Button>
        </div>

        {loading ? (
          <TableSkeleton columns={5} />
        ) : runs.length === 0 ? (
          <EmptyState icon={<FileText />} title={t("Abhi tak koi payroll run nahi hai.")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Month")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead>{t("Generated At")}</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">{run.month}</TableCell>
                  <TableCell>
                    <Badge variant={run.status === "Finalized" ? "default" : "secondary"}>
                      {t(run.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(run.generatedAt).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="flex justify-end gap-2">
                    <RunPayslipsDialog run={run} shortfallByUserId={shortfallsByRun[run.id] ?? {}} />
                    {run.status === "Draft" && (
                      <Button
                        size="sm"
                        disabled={finalizingId === run.id}
                        onClick={() => handleFinalize(run.id)}
                      >
                        {finalizingId === run.id ? "Finalizing..." : t("Finalize karein")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function PayrollAdminConsole() {
  return (
    <div className="space-y-6">
      <SalaryStructuresCard />
      <PayrollRunsCard />
    </div>
  );
}
