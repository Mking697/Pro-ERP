"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { qty, statusVariant, type StockStatus } from "../types";
import { TableSkeleton } from "@/components/loading-states";
import { PackageCheck } from "lucide-react";
import EmptyState from "@/components/empty-state";
import { useT } from "@/components/preferences-provider";
import { cn } from "@/lib/utils";

interface VendorOption {
  vendorId: string;
  vendorName: string;
  leadTimeDays: string;
  unitPrice: string;
}

interface Suggestion {
  sku: string;
  itemName: string;
  uom: string;
  moq: string;
  maxLevel: string;
  free: number;
  onHand: number;
  inTransit: number;
  projected: number;
  rop: number | null;
  status: StockStatus;
  suggestedQty: number;
  vendors: VendorOption[];
}

/**
 * Items that have fallen to their reorder point, with a quantity to order.
 *
 * The suggestion is a starting point, not a decision — every quantity is editable before
 * anything is raised, because the person ordering knows things the formula does not
 * (a supplier's carton size, a price break, a delivery already being negotiated).
 */
export default function ReorderBoard({ canRaise }: { canRaise: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [notSetUp, setNotSetUp] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [retryBlocked, setRetryBlocked] = useState(false);

  useEffect(() => {
    fetch("/api/inventory/reorder")
      .then((res) => res.json())
      .then((data: { suggestions?: Suggestion[]; notSetUp?: number }) => {
        setRows(data.suggestions ?? []);
        setNotSetUp(data.notSetUp ?? 0);
      })
      .catch(() => toast.error(t("Reorder list load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  function qtyFor(row: Suggestion): string {
    return qtyDraft[row.sku] ?? String(row.suggestedQty);
  }

  const chosen = useMemo(
    () => rows.filter((r) => selected[r.sku] && Number(qtyFor(r)) > 0),
    // qtyFor reads qtyDraft, so both have to be dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selected, qtyDraft]
  );

  async function raise() {
    if (retryBlocked || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/inventory/indents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          indents: chosen.map((r) => ({
            sku: r.sku,
            itemName: r.itemName,
            uom: r.uom,
            suggestedQty: r.suggestedQty,
            finalQty: Number(qtyFor(r)),
            reason: "Reorder",
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      // HTTP status describes the batch, not each item: even HTTP 500 can
      // acknowledge committed siblings. Reconcile those before showing failures.
      const requested = new Set(chosen.map((row) => row.sku));
      const receiptsValid = Array.isArray(data?.indents) && data.indents.every(
        (indent: { SKU?: unknown; Indent_ID?: unknown }) =>
          typeof indent?.SKU === "string" && requested.has(indent.SKU) &&
          typeof indent.Indent_ID === "string" && indent.Indent_ID.trim().length > 0
      );
      const failuresValid = Array.isArray(data?.failed) && data.failed.every(
        (failure: { sku?: unknown; error?: unknown }) =>
          typeof failure?.sku === "string" && requested.has(failure.sku) &&
          typeof failure.error === "string"
      );
      const unknownList: { sku?: unknown; error?: unknown }[] = Array.isArray(data?.unknown) ? data.unknown : [];
      const unknownValid = !("unknown" in (data ?? {})) || (Array.isArray(data?.unknown) && unknownList.every(
        (entry) => typeof entry?.sku === "string" && requested.has(entry.sku as string) &&
          typeof entry.error === "string"
      ));
      const saved = new Set<string>(receiptsValid
        ? data.indents.map((indent: { SKU: string }) => indent.SKU) : []);
      const failed = new Set<string>(failuresValid
        ? data.failed.map((failure: { sku: string }) => failure.sku) : []);
      const unknownOutcome = new Set<string>(unknownValid
        ? unknownList.map((entry) => entry.sku as string) : []);
      const resultValid = receiptsValid && failuresValid && unknownValid &&
        data.created === data.indents.length && saved.size === data.created &&
        new Set(data.indents.map((indent: { Indent_ID: string }) => indent.Indent_ID)).size === saved.size &&
        failed.size === data.failed.length &&
        [...failed].every((sku) => !saved.has(sku) && !unknownOutcome.has(sku)) &&
        [...unknownOutcome].every((sku) => !saved.has(sku)) &&
        saved.size + failed.size + unknownOutcome.size === requested.size;
      if (!resultValid) {
        setRetryBlocked(true);
        setVersion((v) => v + 1);
        toast.error(t("Indent result confirm nahi hua. Indents list check karein; bina verify kiye dobara submit na karein."));
        return;
      }
      if (saved.size > 0) {
        setSelected((current) => Object.fromEntries(
          Object.entries(current).filter(([sku]) => !saved.has(sku))
        ));
        setQtyDraft((current) => Object.fromEntries(
          Object.entries(current).filter(([sku]) => !saved.has(sku))
        ));
        setVersion((v) => v + 1);
        toast.success(`${saved.size} indent ban gaye.`);
        if (data?.committed === true || Array.isArray(data?.warnings) && data.warnings.length > 0) {
          // Never render arbitrary server cleanup/error text.
          toast.warning(t("Saved indents confirmed hain; server issue hua. Saved items dobara submit na karein."));
        }
      }
      if (unknownOutcome.size > 0) {
        // Genuinely unknown: may or may not have been written. Keep selected, do not
        // let a retry run — resubmitting could silently duplicate an already-written
        // indent. The person must verify manually via the Indents list.
        setRetryBlocked(true);
        toast.warning(
          t(`${unknownOutcome.size} item ka result confirm nahi hua: ${[...unknownOutcome].join(", ")}. Indents list check karein; bina verify kiye dobara submit na karein.`)
        );
      }
      if (data?.failed?.length) {
        toast.error(
          `${data.failed.length} nahi bane: ${data.failed.map((f: { sku: string }) => f.sku).join(", ")}`
        );
      } else if (!res.ok && unknownOutcome.size === 0) {
        toast.error(t("Indent nahi ban paye."));
      }
    } catch {
      // A transport failure gives no evidence of rollback; replay can duplicate.
      setRetryBlocked(true);
      setVersion((v) => v + 1);
      toast.error(t("Indent result confirm nahi hua. Indents list check karein; bina verify kiye dobara submit na karein."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <TableSkeleton columns={6} label={t("Reorder list load ho rahi hai")} />;
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected[r.sku]);

  return (
    <div className="space-y-4">
      {retryBlocked && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {t("Indent result confirm nahi hua. Bina verify kiye dobara submit na karein.")}{" "}
          <Link href="/inventory/indents" className="underline">
            {t("Indents list check karein")}
          </Link>
        </p>
      )}
      {notSetUp > 0 && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <strong className="text-foreground">{notSetUp}</strong> item is list me hain hi
          nahi, kyunki unka reorder point nahi ban raha. Unke planning fields{" "}
          <Link href="/inventory/setup" className="underline">
            Bulk Setup
          </Link>{" "}
          se bhar dijiye — warna wo chupchaap khatam ho sakte hain.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<PackageCheck />}
          title={t("Abhi kisi item ko order ki zaroorat nahi")}
          description={t("Har item apne reorder point se upar hai.")}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {rows.length} item reorder point par ya usse neeche
            </span>
            {canRaise && (
              <Button
                className="ml-auto"
                onClick={raise}
                disabled={saving || retryBlocked || chosen.length === 0}
              >
                {saving ? "Ban rahe hain..." : `Indent banayein (${chosen.length})`}
              </Button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {canRaise && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        aria-label={t("Sab select karein")}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked === true
                              ? Object.fromEntries(rows.map((r) => [r.sku, true]))
                              : {}
                          )
                        }
                      />
                    </TableHead>
                  )}
                  <TableHead>Item</TableHead>
                  <TableHead>{t("Suggested Vendor")}</TableHead>
                  <TableHead className="text-right">Free</TableHead>
                  <TableHead className="text-right">In Transit</TableHead>
                  <TableHead className="text-right">Projected</TableHead>
                  <TableHead className="text-right">ROP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Order Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow
                    key={row.sku}
                    style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                    className={cn(
                      "animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both",
                      selected[row.sku] && "bg-accent/40"
                    )}
                  >
                    {canRaise && (
                      <TableCell>
                        <Checkbox
                          checked={selected[row.sku] === true}
                          aria-label={`${row.itemName} select karein`}
                          onCheckedChange={(checked) =>
                            setSelected((s) => ({ ...s, [row.sku]: checked === true }))
                          }
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Link
                        href={`/inventory/${encodeURIComponent(row.sku)}`}
                        className="font-medium hover:underline"
                      >
                        {row.itemName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {row.sku}
                        {row.moq && ` · MOQ ${row.moq}`}
                        {row.maxLevel && ` · Max ${row.maxLevel}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.vendors.length === 0 ? (
                        <span className="text-muted-foreground">{t("Koi vendor linked nahi")}</span>
                      ) : (
                        <div className="space-y-0.5">
                          {row.vendors.slice(0, 2).map((v) => (
                            <div key={v.vendorId} className="whitespace-nowrap">
                              <span className="font-medium">{v.vendorName}</span>
                              <span className="ml-1 text-xs text-muted-foreground">
                                {v.unitPrice ? `₹${v.unitPrice}/${row.uom}` : t("Price nahi hai")}
                                {v.leadTimeDays && ` · ${v.leadTimeDays}d`}
                              </span>
                            </div>
                          ))}
                          {row.vendors.length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{row.vendors.length - 2} {t("aur vendor")}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qty(row.free)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.inTransit > 0 ? qty(row.inTransit) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {qty(row.projected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {qty(row.rop)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={qtyFor(row)}
                        onChange={(e) =>
                          setQtyDraft((d) => ({ ...d, [row.sku]: e.target.value }))
                        }
                        disabled={!canRaise}
                        className="h-8 text-right tabular-nums"
                        aria-label={`${row.itemName} — order quantity`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
