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

export default function BomBoard() {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [setupRequired, setSetupRequired] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/bom")
      .then((res) => res.json())
      .then((data: { boms?: Bom[]; setupRequired?: string | null }) => {
        setBoms(data.boms ?? []);
        setSetupRequired(data.setupRequired ?? null);
      })
      .catch(() => toast.error("BOMs load nahi ho payi."))
      .finally(() => setLoading(false));
  }, [version]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  }

  if (setupRequired) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="text-sm font-medium">&quot;{setupRequired}&quot; sheet connect nahi hui</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          render={<Link href="/admin/settings">Settings kholein</Link>}
        />
      </div>
    );
  }

  const visible = boms.filter((b) => showArchived || b.status === "Active");
  const archivedCount = boms.filter((b) => b.status !== "Active").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {archivedCount > 0 && (
          <Button
            size="sm"
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived((v) => !v)}
          >
            Purani versions
            <span className="ml-1.5 tabular-nums opacity-70">{archivedCount}</span>
          </Button>
        )}
        <div className="ml-auto">
          <BomForm
            onCreated={() => setVersion((v) => v + 1)}
            known={boms.map((b) => ({ productName: b.productName, productSku: b.productSku }))}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-sm font-medium">Abhi koi BOM nahi hai</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Production planning tabhi chalegi jab product ki BOM bani ho.
          </p>
        </div>
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
                            <TableHead className="text-right">Qty / unit</TableHead>
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
