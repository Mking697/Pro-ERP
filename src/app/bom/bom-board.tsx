"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import BomForm from "./bom-form";
import { CardListSkeleton } from "@/components/loading-states";
import { ClipboardList } from "lucide-react";
import EmptyState from "@/components/empty-state";
import { useT } from "@/components/preferences-provider";
import CreateItemDialog from "@/app/inventory/create-item-dialog";
import BulkImportDialog from "@/app/inventory/bulk-import-dialog";

interface BomLine {
  lineNo: number;
  componentSku: string;
  componentName: string;
  qtyPerUnit: number;
  uom: string;
}

interface Bom {
  bomId: string;
  productName: string;
  productSku: string;
  version: number;
  status: string;
  createdAt: string;
  createdBy: string;
  lines: BomLine[];
}

export default function BomBoard({
  canCreateFgItem,
}: {
  /** Whether this viewer holds INVENTORY_SETUP — the "+ FG Banayein" button only
   * appears for them, since the API it calls needs that same grant. Everyone else still
   * sees the "FG nahi bani" note, just without a button that would only 403 for them. */
  canCreateFgItem: boolean;
}) {
  const t = useT();
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [existingSkus, setExistingSkus] = useState<Set<string> | null>(null);
  const [uomOptions, setUomOptions] = useState<string[]>([]);
  const [sizeUnitOptions, setSizeUnitOptions] = useState<string[]>([]);
  const [locationOptions, setLocationOptions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/bom")
      .then((res) => res.json())
      .then((data: { boms?: Bom[] }) => {
        setBoms(data.boms ?? []);
      })
      .catch(() => toast.error(t("BOMs load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  // Whether each product's own Item already exists — only relevant for surfacing a "FG
  // nahi bani" nudge, so a 403 (a BOM_MANAGE-only viewer without INVENTORY_VIEW) is
  // simply swallowed and the nudge stays off, same degrade-quietly pattern as every other
  // cross-module read in this app.
  useEffect(() => {
    fetch("/api/inventory/items")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            items?: { SKU: string; UOM: string; Size_Unit: string; Location: string }[];
          } | null
        ) => {
          if (!data) return;
          const items = data.items ?? [];
          setExistingSkus(new Set(items.map((i) => i.SKU)));
          setUomOptions([...new Set(items.map((i) => i.UOM).filter(Boolean))]);
          setSizeUnitOptions([...new Set(items.map((i) => i.Size_Unit).filter(Boolean))]);
          setLocationOptions([...new Set(items.map((i) => i.Location).filter(Boolean))]);
        }
      )
      .catch(() => {});
  }, [version]);

  if (loading) {
    return <CardListSkeleton label={t("BOMs load ho rahi hain")} />;
  }

  const visible = boms.filter((b) => showArchived || b.status === "Active");
  const archivedCount = boms.filter((b) => b.status !== "Active").length;
  const missingFgCount =
    existingSkus === null
      ? 0
      : boms.filter((b) => b.status === "Active" && !existingSkus.has(b.productSku)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {archivedCount > 0 && (
          <Button
            size="sm"
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived((v) => !v)}
          >{t("Purani versions")}<span className="ml-1.5 tabular-nums opacity-70">{archivedCount}</span>
          </Button>
        )}
        {canCreateFgItem && missingFgCount > 0 && (
          <BulkImportDialog
            onImported={() => setVersion((v) => v + 1)}
            forcedCategory="FG"
            triggerLabel={t("FG Items Bulk Import Karein")}
          />
        )}
        <div className="ml-auto">
          <BomForm
            onCreated={() => setVersion((v) => v + 1)}
            known={boms.map((b) => ({ productName: b.productName, productSku: b.productSku }))}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t("Abhi koi BOM nahi hai")}
          description={t("Production planning tabhi chalegi jab product ki BOM bani ho.")}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((bom) => {
            const isOpen = expanded === bom.bomId;
            return (
              <Card key={bom.bomId}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {bom.productName}
                        <Badge variant={bom.status === "Active" ? "default" : "outline"}>
                          {bom.status === "Active" ? `v${bom.version}` : `v${bom.version} · Archived`}
                        </Badge>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {bom.lines.length} item · {formatDueDisplay(bom.createdAt)} ·{" "}
                        {bom.createdBy}
                      </p>
                      {bom.status === "Active" &&
                        existingSkus !== null &&
                        !existingSkus.has(bom.productSku) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="destructive">
                              {t("Iska FG Item nahi bana")}
                            </Badge>
                            {canCreateFgItem && (
                              <CreateItemDialog
                                onCreated={() => setVersion((v) => v + 1)}
                                defaultCategory="FG"
                                categoryOptions={["FG"]}
                                initialSku={bom.productSku}
                                initialItemName={bom.productName}
                                uomOptions={uomOptions}
                                sizeUnitOptions={sizeUnitOptions}
                                locationOptions={locationOptions}
                                trigger={
                                  <Button variant="outline" size="sm">
                                    {t("+ FG Banayein")}
                                  </Button>
                                }
                              />
                            )}
                          </div>
                        )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpanded(isOpen ? null : bom.bomId)}
                    >
                      {isOpen ? "Chhupayein" : "Items dekhein"}
                    </Button>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Item</TableHead>
                            <TableHead className="text-right">{t("Qty / unit")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bom.lines.map((line) => (
                            <TableRow key={line.lineNo}>
                              <TableCell className="text-muted-foreground">
                                {line.lineNo}
                              </TableCell>
                              <TableCell>
                                <Link
                                  href={`/inventory/${encodeURIComponent(line.componentSku)}`}
                                  className="font-medium hover:underline"
                                >
                                  {line.componentName}
                                </Link>
                                <span className="block text-xs text-muted-foreground">
                                  {line.componentSku}
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {line.qtyPerUnit}
                                <span className="ml-1 text-xs font-normal text-muted-foreground">
                                  {line.uom}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
