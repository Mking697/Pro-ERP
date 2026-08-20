"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useConfirm } from "@/components/confirm-dialog";
import PlanForm from "./plan-form";
import { CardListSkeleton } from "@/components/loading-states";
import SheetNotConnected from "@/components/sheet-not-connected";
import { Factory } from "lucide-react";
import EmptyState from "@/components/empty-state";
import { useT } from "@/components/preferences-provider";

interface PlanMaterial {
  sku: string;
  itemName: string;
  uom: string;
  qtyPerUnit: number;
  requiredQty: number;
  allocatedQty: number;
  shortageQty: number;
  consumedQty: number;
}

interface Plan {
  planId: string;
  productName: string;
  productSku: string;
  bomVersion: number;
  plannedQty: number;
  productionDate: string;
  status: "Ready" | "Shortage" | "In_Production" | "Completed" | "Cancelled";
  actualQty: number | null;
  startedBy: string;
  materials: PlanMaterial[];
}

const STATUS_LABEL: Record<Plan["status"], string> = {
  Ready: "Ready",
  Shortage: "Material kam",
  In_Production: "Chal raha hai",
  Completed: "Ho gaya",
  Cancelled: "Cancel",
};

function statusVariant(status: Plan["status"]) {
  if (status === "Shortage") return "destructive" as const;
  if (status === "Completed" || status === "Cancelled") return "outline" as const;
  return "default" as const;
}

export default function PlanBoard({ access }: { access: string[] }) {
  const t = useT();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [starting, setStarting] = useState<Plan | null>(null);
  const [actualQty, setActualQty] = useState("");
  const [version, setVersion] = useState(0);

  const confirm = useConfirm();

  const canPlan = access.includes("PPC_PLAN");
  const canRun = access.includes("INVENTORY_TXN");

  // No setLoading(true) here: on a refresh the list stays on screen until the new data
  // lands, which reads better than flashing a spinner over it.
  useEffect(() => {
    fetch("/api/ppc/plans")
      .then((res) => res.json())
      .then((data: { plans?: Plan[]; setupRequired?: string | null }) => {
        setPlans(data.plans ?? []);
        setSetupRequired(data.setupRequired ?? null);
      })
      .catch(() => toast.error(t("Plans load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  async function act(planId: string, body: Record<string, unknown>, done: string) {
    setBusy(planId);
    try {
      const res = await fetch(`/api/ppc/plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Kaam nahi hua.");
        return false;
      }
      toast.success(done);
      refresh();
      return true;
    } catch {
      toast.error(t("Kaam nahi hua."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleStart() {
    if (!starting) return;
    const qty = Number(actualQty);
    if (!(qty > 0)) {
      toast.error(t("Actual quantity 0 se zyada honi chahiye."));
      return;
    }
    const ok = await act(
      starting.planId,
      { action: "start", actualQty: qty },
      `${starting.productName} — ${qty} unit ka material issue ho gaya, bacha hua reserve free ho gaya.`
    );
    if (ok) {
      setStarting(null);
      setActualQty("");
    }
  }

  if (loading) {
    return <CardListSkeleton label={t("Plans load ho rahe hain")} />;
  }

  if (setupRequired) {
    return (
      <SheetNotConnected
        what={setupRequired}
        hint="PPC ke liye Production Plans aur Plan Materials — dono sheet chahiye."
      />
    );
  }

  const closed = plans.filter(
    (p) => p.status === "Completed" || p.status === "Cancelled"
  );
  const visible = showClosed
    ? plans
    : plans.filter((p) => p.status !== "Completed" && p.status !== "Cancelled");

  const shortages = plans
    .filter((p) => p.status === "Shortage")
    .flatMap((p) => p.materials.filter((m) => m.shortageQty > 0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {closed.length > 0 && (
          <Button
            size="sm"
            variant={showClosed ? "default" : "outline"}
            onClick={() => setShowClosed((v) => !v)}
          >{t("Purane plan")}<span className="ml-1.5 tabular-nums opacity-70">{closed.length}</span>
          </Button>
        )}
        {shortages.length > 0 && (
          <Button size="sm" variant="outline" render={<Link href="/inventory/reorder">{t("Indent raise karein")}</Link>} />
        )}
        {canPlan && (
          <div className="ml-auto">
            <PlanForm onCreated={refresh} />
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Factory />}
          title={t("Koi chalu plan nahi hai")}
          description={t("Naya plan banate hi uska material reserve ho jaata hai.")}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((plan) => {
            const isOpen = expanded === plan.planId;
            const open = plan.status === "Ready" || plan.status === "Shortage";
            const shortQty = plan.materials.reduce((sum, m) => sum + m.shortageQty, 0);

            return (
              <Card key={plan.planId}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {plan.productName}
                        <Badge variant={statusVariant(plan.status)}>
                          {STATUS_LABEL[plan.status]}
                        </Badge>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plan.plannedQty} unit · {plan.productionDate} · BOM v
                        {plan.bomVersion}
                        {plan.actualQty !== null && ` · bane ${plan.actualQty}`}
                        {shortQty > 0 && ` · ${shortQty} material kam`}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {open && canPlan && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === plan.planId}
                          onClick={() =>
                            act(
                              plan.planId,
                              { action: "recheck" },
                              "Stock dobara check ho gaya."
                            )
                          }
                        >{t("Dobara check")}</Button>
                      )}
                      {open && canRun && (
                        <Button
                          size="sm"
                          disabled={busy === plan.planId}
                          onClick={() => {
                            setStarting(plan);
                            setActualQty(String(plan.plannedQty));
                          }}
                        >{t("Production shuru")}</Button>
                      )}
                      {plan.status === "In_Production" && canRun && (
                        <Button
                          size="sm"
                          disabled={busy === plan.planId}
                          onClick={() =>
                            act(plan.planId, { action: "complete" }, "Plan complete ho gaya.")
                          }
                        >
                          Complete
                        </Button>
                      )}
                      {open && canPlan && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === plan.planId}
                          onClick={() =>
                            confirm.ask({
                              title: `${plan.productName} ka plan cancel karein?`,
                              description: `Is plan ne jo material rok rakha hai wo free ho jaayega, aur agla plan use le sakta hai. ${plan.plannedQty} unit ka ye plan wapas nahi aayega — dobara banana padega.`,
                              confirmLabel: "Haan, cancel karein",
                              onConfirm: () =>
                                act(
                                  plan.planId,
                                  { action: "cancel" },
                                  "Plan cancel ho gaya, material free ho gaya."
                                ),
                            })
                          }
                        >
                          Cancel
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : plan.planId)}
                      >
                        {isOpen ? "Chhupayein" : "Material"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">{t("Chahiye")}</TableHead>
                            <TableHead className="text-right">Reserve</TableHead>
                            <TableHead className="text-right">{t("Kam")}</TableHead>
                            <TableHead className="text-right">{t("Laga")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plan.materials.map((m) => (
                            <TableRow key={m.sku}>
                              <TableCell>
                                <Link
                                  href={`/inventory/${encodeURIComponent(m.sku)}`}
                                  className="font-medium hover:underline"
                                >
                                  {m.itemName}
                                </Link>
                                <span className="block text-xs text-muted-foreground">
                                  {m.sku} · {m.qtyPerUnit} {m.uom}/unit
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {m.requiredQty} {m.uom}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {m.allocatedQty}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {m.shortageQty > 0 ? m.shortageQty : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {m.consumedQty > 0 ? m.consumedQty : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Ye is plan ka apna BOM snapshot hai — BOM baad me badle to bhi ye
                      nahi badlega.
                    </p>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {confirm.dialog}

      <Dialog open={starting !== null} onOpenChange={(v) => !v && setStarting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Production shuru karein")}</DialogTitle>
            <DialogDescription>
              Kitne unit actually ban rahe hain? Utne ka hi material issue hoga, aur bacha
              hua reserve turant free ho jaayega.
            </DialogDescription>
          </DialogHeader>

          {starting && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{starting.productName}</p>
                <p className="text-muted-foreground">
                  Plan {starting.plannedQty} unit ka tha · {starting.productionDate}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="actualQty">Actual quantity</Label>
                <Input
                  id="actualQty"
                  type="number"
                  step="any"
                  min="0"
                  value={actualQty}
                  onChange={(e) => setActualQty(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button onClick={handleStart} disabled={busy !== null}>
              {busy ? "Ho raha hai..." : "Material issue karein"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
