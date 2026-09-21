"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import CreateItemDialog from "./create-item-dialog";
import BulkImportDialog from "./bulk-import-dialog";
import StockMovementDialog from "./stock-movement-dialog";
import { qty, statusVariant, type ItemRow, type StockStatus } from "./types";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import type { ItemCategory } from "@/lib/inventory/constants";

const GOODS_CATEGORIES: ItemCategory[] = ["Raw Material", "Consumable", "Semi-FG"];
const FG_CATEGORIES: ItemCategory[] = ["FG"];

interface BomProductRow {
  productName: string;
  productSku: string;
  status: string;
}

const STATUS_FILTERS: (StockStatus | "All")[] = [
  "All",
  "Out of Stock",
  "Critical",
  "Low",
  "Healthy",
  "Overstock",
  "Not Set Up",
];

export default function InventoryBoard({
  canTransact,
  canSetup,
  scope = "goods",
}: {
  canTransact: boolean;
  canSetup: boolean;
  /** "goods" (default, the main /inventory page) shows everything except Finished Goods
   * — FG gets its own board (scope="finished", /inventory/fg) so it never sits mixed in
   * with raw material/consumable/semi-FG stock. Both read the same live items+ledger
   * data; this is a display split, not a separate stock system. */
  scope?: "goods" | "finished";
}) {
  const t = useT();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StockStatus | "All">("All");
  const [version, setVersion] = useState(0);
  const [boms, setBoms] = useState<BomProductRow[]>([]);

  useEffect(() => {
    fetch("/api/inventory/items")
      .then((res) => res.json())
      .then((data: { items?: ItemRow[] }) => {
        setItems(data.items ?? []);
      })
      .catch(() => toast.error(t("Items load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  // A product's Item is only auto-created going forward, the moment its BOM is next
  // saved (see createBom()) — a product whose BOM predates that fix still has no Item,
  // and its FG stock write will keep failing until one exists. Best-effort: a viewer
  // without BOM_MANAGE simply never sees this banner, same as any other degrade-quietly
  // read in this app (e.g. the Dashboard's per-module charts).
  useEffect(() => {
    if (scope !== "finished" || !canSetup) return;
    fetch("/api/bom")
      .then((res) => (res.ok ? res.json() : { boms: [] }))
      .then((data: { boms?: BomProductRow[] }) => setBoms(data.boms ?? []))
      .catch(() => {});
  }, [scope, canSetup, version]);

  // Suggestions for the New Item dialog's UOM/Size-Unit autocomplete — whatever every
  // other item in the org already uses, so a new item's units almost never need typing
  // from scratch.
  const uomOptions = useMemo(
    () => [...new Set(items.map((i) => i.UOM).filter(Boolean))],
    [items]
  );
  const sizeUnitOptions = useMemo(
    () => [...new Set(items.map((i) => i.Size_Unit).filter(Boolean))],
    [items]
  );
  const locationOptions = useMemo(
    () => [...new Set(items.map((i) => i.Location).filter(Boolean))],
    [items]
  );

  const missingFgItems = useMemo(() => {
    if (scope !== "finished") return [];
    const existingSkus = new Set(items.map((i) => i.SKU));
    const seen = new Set<string>();
    const missing: { productName: string; productSku: string }[] = [];
    for (const b of boms) {
      if (b.status !== "Active" || !b.productSku) continue;
      if (existingSkus.has(b.productSku) || seen.has(b.productSku)) continue;
      seen.add(b.productSku);
      missing.push({ productName: b.productName, productSku: b.productSku });
    }
    return missing;
  }, [scope, items, boms]);

  const scoped = useMemo(
    () => items.filter((i) => (scope === "finished" ? i.Category === "FG" : i.Category !== "FG")),
    [items, scope]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((i) => {
      if (status !== "All" && i.status !== status) return false;
      if (!q) return true;
      return (
        i.Item_Name.toLowerCase().includes(q) ||
        i.SKU.toLowerCase().includes(q) ||
        i.Category.toLowerCase().includes(q) ||
        i.Size_Unit.toLowerCase().includes(q)
      );
    });
  }, [scoped, search, status]);

  // Counts come from the scoped-but-unfiltered list so the chips keep showing what
  // exists in this board (goods or finished) even while a status filter narrows the table.
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: scoped.length };
    for (const i of scoped) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [scoped]);

  const needsSetup = scoped.filter((i) => i.missingFields.length > 0).length;

  if (loading) {
    return <TableSkeleton columns={6} label={t("Items load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("Item ya SKU search karein")}
          placeholder={t("Item ya SKU search karein...")}
          className="h-9 max-w-xs"
        />
        {scope === "goods" && (
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/inventory/reorder">Reorder</Link>}
            />
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/inventory/indents">Indents</Link>}
            />
          </div>
        )}
        {canSetup && (
          <div className={cn("flex gap-2", scope === "finished" && "ml-auto")}>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/inventory/setup">Bulk Setup</Link>}
            />
            <BulkImportDialog
              onImported={() => setVersion((v) => v + 1)}
              forcedCategory={scope === "finished" ? "FG" : undefined}
            />
            <CreateItemDialog
              onCreated={() => setVersion((v) => v + 1)}
              defaultCategory={scope === "finished" ? "FG" : "Raw Material"}
              categoryOptions={scope === "finished" ? FG_CATEGORIES : GOODS_CATEGORIES}
              uomOptions={uomOptions}
              sizeUnitOptions={sizeUnitOptions}
              locationOptions={locationOptions}
            />
          </div>
        )}
      </div>

      {missingFgItems.length > 0 && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{missingFgItems.length}</strong>{" "}
            {t(
              "product ki BOM ban chuki hai lekin unka Item abhi FG me nahi hai — production complete hone par inki FG stock write nahi ho paayegi, jab tak ye add na ho jaayein."
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {missingFgItems.map((p) => (
              <CreateItemDialog
                key={p.productSku}
                onCreated={() => setVersion((v) => v + 1)}
                defaultCategory="FG"
                categoryOptions={FG_CATEGORIES}
                initialSku={p.productSku}
                initialItemName={p.productName}
                uomOptions={uomOptions}
                sizeUnitOptions={sizeUnitOptions}
                locationOptions={locationOptions}
                trigger={
                  <Button variant="outline" size="sm">
                    {`+ ${p.productName}`}
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.filter((s) => s === "All" || counts[s]).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[s] ?? 0}</span>
          </Button>
        ))}
      </div>

      {needsSetup > 0 && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <strong className="text-foreground">{needsSetup}</strong> item ke planning
          fields adhoore hain, isliye unka reorder point nahi ban raha. Bulk Setup se
          bhar dijiye.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Free</TableHead>
              <TableHead className="text-right">On Hand</TableHead>
              <TableHead className="text-right">ADC</TableHead>
              <TableHead className="text-right">ROP</TableHead>
              <TableHead>Status</TableHead>
              {canTransact && <TableHead className="text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canTransact ? 8 : 7}
                  className="py-10 text-center text-muted-foreground"
                >
                  {items.length === 0
                    ? t("Abhi koi item nahi hai.")
                    : t("Is filter par koi item nahi mila.")}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((item) => (
              <TableRow key={item.SKU}>
                <TableCell>
                  <Link
                    href={`/inventory/${encodeURIComponent(item.SKU)}`}
                    className="font-medium hover:underline"
                  >
                    {item.Item_Name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {item.SKU}
                    {item.Size_Unit && ` · ${item.Size_Unit}`}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {item.Category}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums",
                    item.free <= 0 && "text-destructive"
                  )}
                >
                  {qty(item.free)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {item.UOM}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {qty(item.onHand)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {qty(item.adc)}
                  {item.adcIsManual && (
                    <span className="ml-1 text-xs" title={t("Manually set")}>
                      ✎
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {qty(item.rop)}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                  {item.missingFields.length > 0 && (
                    <span
                      className="block text-xs text-muted-foreground"
                      title={`Baaki: ${item.missingFields.join(", ")}`}
                    >
                      {item.missingFields.length} field baaki
                    </span>
                  )}
                </TableCell>
                {canTransact && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <StockMovementDialog
                        item={item}
                        direction="In"
                        onDone={() => setVersion((v) => v + 1)}
                      />
                      <StockMovementDialog
                        item={item}
                        direction="Out"
                        onDone={() => setVersion((v) => v + 1)}
                      />
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
