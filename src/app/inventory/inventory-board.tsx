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
import StockMovementDialog from "./stock-movement-dialog";
import { qty, statusVariant, type ItemRow, type StockStatus } from "./types";
import { TableSkeleton } from "@/components/loading-states";

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
}: {
  canTransact: boolean;
  canSetup: boolean;
}) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [missingSheets, setMissingSheets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StockStatus | "All">("All");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/inventory/items")
      .then((res) => res.json())
      .then((data: { items?: ItemRow[]; missingSheets?: string[] }) => {
        setItems(data.items ?? []);
        setMissingSheets(data.missingSheets ?? []);
      })
      .catch(() => toast.error("Items load nahi ho paye."))
      .finally(() => setLoading(false));
  }, [version]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (status !== "All" && i.status !== status) return false;
      if (!q) return true;
      return (
        i.Item_Name.toLowerCase().includes(q) ||
        i.SKU.toLowerCase().includes(q) ||
        i.Category.toLowerCase().includes(q) ||
        i.Size_Unit.toLowerCase().includes(q)
      );
    });
  }, [items, search, status]);

  // Counts come from the unfiltered list so the chips keep showing what exists
  // even while a filter is narrowing the table.
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: items.length };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [items]);

  const needsSetup = items.filter((i) => i.missingFields.length > 0).length;

  if (loading) {
    return <TableSkeleton columns={6} label="Items load ho rahe hain" />;
  }

  if (missingSheets.length > 0) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="text-sm font-medium">Inventory ki sheets abhi connect nahi hui</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Baaki hain: {missingSheets.join(", ")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          render={<Link href="/admin/settings">Settings kholein</Link>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Item ya SKU search karein..."
          className="h-9 max-w-xs"
        />
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
        {canSetup && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/inventory/setup">Bulk Setup</Link>}
            />
            <CreateItemDialog onCreated={() => setVersion((v) => v + 1)} />
          </div>
        )}
      </div>

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
                    ? "Abhi koi item nahi hai."
                    : "Is filter par koi item nahi mila."}
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
                    <span className="ml-1 text-xs" title="Manually set">
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
