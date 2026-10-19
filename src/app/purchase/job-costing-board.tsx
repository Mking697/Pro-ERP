"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/empty-state";
import { Calculator } from "lucide-react";
import { useT } from "@/components/preferences-provider";

interface PlanOption {
  id: string;
  jobNo: string;
  productName: string;
  status: string;
}

interface JobCostingLine {
  source: "Raw_Material" | "General";
  poId: string;
  particular: string;
  qty: number;
  rate: number;
  amount: number;
}

interface JobCostingReport {
  planId: string;
  jobNo: string;
  productName: string;
  rawMaterialCost: number;
  generalCost: number;
  totalCost: number;
  lines: JobCostingLine[];
}

/**
 * The Independent PO feature's own payoff — total real cost against one Job (Production
 * Plan), combining the existing raw-material Indent->PO chain with General PO lines
 * tagged to the same job. Deliberately cost-only, no margin — see
 * src/lib/purchase/generalOrders.ts's jobCostingForPlan() for exactly why.
 */
export default function JobCostingBoard() {
  const t = useT();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [report, setReport] = useState<JobCostingReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/purchase/general/plans-lookup")
      .then((res) => res.json())
      .then((data: { plans?: PlanOption[] }) => setPlans(data.plans ?? []))
      .catch(() => toast.error(t("Jobs (Production Plans) load nahi ho paye.")));
  }, [t]);

  useEffect(() => {
    if (!planId) return;
    fetch(`/api/purchase/job-costing?planId=${encodeURIComponent(planId)}`)
      .then((res) => res.json())
      .then((data: { report?: JobCostingReport; error?: string }) => {
        if (data.report) setReport(data.report);
        else toast.error(t(data.error ?? "Job costing load nahi ho paya."));
      })
      .catch(() => toast.error(t("Job costing load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [planId, t]);

  return (
    <div className="space-y-4">
      <div className="max-w-sm space-y-2">
        <Label htmlFor="job-costing-plan">{t("Job (Production Plan) chunein")}</Label>
        <Select
          value={planId || undefined}
          onValueChange={(v) => {
            if (!v) return;
            setReport(null);
            setLoading(true);
            setPlanId(v);
          }}
        >
          <SelectTrigger id="job-costing-plan" className="w-full">
            <SelectValue placeholder={t("Job chunein")} />
          </SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {(p.jobNo || p.id) + " — " + p.productName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!planId ? (
        <EmptyState
          icon={<Calculator />}
          title={t("Ek Job chunein")}
          description={t(
            "Raw material (Indent/PO se) aur General PO dono ka cost is Job ke against jod kar dikhaya jaayega."
          )}
        />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("Raw Material Cost")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {report.rawMaterialCost.toFixed(2)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("General PO Cost")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {report.generalCost.toFixed(2)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t("Total Job Cost")}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums text-primary">
                {report.totalCost.toFixed(2)}
              </CardContent>
            </Card>
          </div>

          {report.lines.length === 0 ? (
            <EmptyState
              icon={<Calculator />}
              title={t("Is Job ke against abhi tak koi kharidari nahi hui")}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Source")}</TableHead>
                    <TableHead>{t("PO")}</TableHead>
                    <TableHead>{t("Particular")}</TableHead>
                    <TableHead className="text-right">{t("Qty")}</TableHead>
                    <TableHead className="text-right">{t("Rate")}</TableHead>
                    <TableHead className="text-right">{t("Amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line, i) => (
                    <TableRow key={`${line.poId}-${i}`}>
                      <TableCell>
                        <Badge variant={line.source === "Raw_Material" ? "secondary" : "outline"}>
                          {line.source === "Raw_Material" ? t("Raw Material") : t("General")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{line.poId}</TableCell>
                      <TableCell>{line.particular}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{line.rate.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {line.amount.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t(
              "Ye sirf cost hai, margin/profit nahi — kyunki is Job se juda koi real Sales Order link abhi tak nahi hai."
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}
