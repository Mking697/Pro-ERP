"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface CurrencyRow {
  code: string;
  name: string;
  symbol: string;
  isEnabled: boolean;
}

/**
 * Multi-currency DISPLAY/REFERENCE layer (Phase C) admin settings — toggles which foreign
 * currencies this org offers on Orders/Invoices/POs, and lets an Admin record a new
 * exchange-rate history row for each enabled one. INR is always on, never toggleable (see
 * src/lib/currency/currency.ts's listEnabledCurrencies()).
 */
export default function CurrencySettingsForm() {
  const t = useT();
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/admin/currencies")
      .then((res) => res.json())
      .then((data: { currencies?: CurrencyRow[] }) => setCurrencies(data.currencies ?? []))
      .catch(() => toast.error(t("Currency list load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  async function handleToggle(row: CurrencyRow, enabled: boolean) {
    setBusyCode(row.code);
    try {
      const res = await fetch("/api/admin/currencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: row.code, enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Currency toggle nahi hua."));
        return;
      }
      setCurrencies(data.currencies ?? []);
    } finally {
      setBusyCode(null);
    }
  }

  async function handleSaveRate(row: CurrencyRow) {
    const value = Number(rateDraft[row.code]);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t("Rate 0 se zyada hona chahiye."));
      return;
    }
    setBusyCode(row.code);
    try {
      const res = await fetch(`/api/admin/currencies/${row.code}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rateToInr: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Rate save nahi hua."));
        return;
      }
      toast.success(t("Rate save ho gaya."));
      setRateDraft((d) => ({ ...d, [row.code]: "" }));
      setVersion((v) => v + 1);
    } finally {
      setBusyCode(null);
    }
  }

  if (loading) {
    return <FormSkeleton fields={3} label={t("Currency settings load ho rahi hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Multi-Currency")}</CardTitle>
        <CardDescription>
          {t(
            "Orders/Invoices/PO par ek foreign currency ka face amount dikhayein — asli INR value (order value/final value) hamesha jaisi hai waisi hi rehti hai, sirf iske saath ek reference amount dikhta hai."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Currency")}</TableHead>
                <TableHead>{t("Enabled")}</TableHead>
                <TableHead>{t("Naya Rate (1 unit = ? INR)")}</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currencies.map((row) => {
                const busy = busyCode === row.code;
                const isInr = row.code === "INR";
                return (
                  <TableRow key={row.code}>
                    <TableCell className="whitespace-nowrap">
                      {row.symbol} {row.code} — {t(row.name)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.isEnabled}
                        disabled={isInr || busy}
                        onCheckedChange={(checked) => handleToggle(row, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      {!isInr && row.isEnabled && (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="h-8 w-28"
                          value={rateDraft[row.code] ?? ""}
                          onChange={(e) =>
                            setRateDraft((d) => ({ ...d, [row.code]: e.target.value }))
                          }
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!isInr && row.isEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !rateDraft[row.code]}
                          onClick={() => handleSaveRate(row)}
                        >
                          {t("Rate Update Karein")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-muted-foreground">
          <Label>{t("Note:")}</Label>{" "}
          {t(
            "Rate hamesha history me add hota hai — purane orders/invoices/POs apna hi snapshot rate dikhate rehte hain, naya rate add karne se unki value nahi badalti."
          )}
        </p>
      </CardContent>
    </Card>
  );
}
