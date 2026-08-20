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
}

/**
 * Items that have fallen to their reorder point, with a quantity to order.
 *
 * The suggestion is a starting point, not a decision — every quantity is editable before
 * anything is raised, because the person ordering knows things the formula does not
 * (a supplier's carton size, a price break, a delivery already being negotiated).
 */
export default function ReorderBoard({ canRaise }: { canRaise: boolean }) {
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [notSetUp, setNotSetUp] = useState(0);
  const [missingSheets, setMissingSheets] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/inventory/reorder")
      .then((res) => res.json())
      .then(
        (data: {
          suggestions?: Suggestion[];
          notSetUp?: number;
          missingSheets?: string[];
        }) => {
          setRows(data.suggestions ?? []);
          setNotSetUp(data.notSetUp ?? 0);
          setMissingSheets(data.missingSheets ?? []);
        }
      )
      .catch(() => toast.error("Reorder list load nahi ho payi."))
      .finally(() => setLoading(false));
  }, [version]);

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

      if (!res.ok) {
        toast.error(data?.error ?? "Indent nahi ban paye.");
        return;
      }

      toast.success(`${data.created} indent ban gaye.`);
      if (data.failed?.length) {
        toast.error(
          `${data.failed.length} nahi bane: ${data.failed.map((f: { sku: string }) => f.sku).join(", ")}`
        );
      }

      setSelected({});
      setQtyDraft({});
      setVersion((v) => v + 1);
    } catch {
      toast.error("Indent nahi ban paye.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  }

  if (missingSheets.length > 0) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="text-sm font-medium">Inventory sheets connect nahi hui</p>
        <p className="mt-1 text-sm text-muted-foreground">{missingSheets.join(", ")}</p>
      </div>
    );
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected[r.sku]);

  return (
    <div className="space-y-4">
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
        <div className="rounded-lg border p-10 text-center">
          <p className="text-sm font-medium">Abhi kisi item ko order ki zaroorat nahi</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Har item apne reorder point se upar hai.
          </p>
        </div>
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
                disabled={saving || chosen.length === 0}
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
                        aria-label="Sab select karein"
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
                  <TableHead className="text-right">Free</TableHead>
                  <TableHead className="text-right">In Transit</TableHead>
                  <TableHead className="text-right">Projected</TableHead>
                  <TableHead className="text-right">ROP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Order Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.sku}>
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
