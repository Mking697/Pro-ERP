"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Product {
  productName: string;
  productSku: string;
  version: number;
  componentCount: number;
}

interface PreviewMaterial {
  sku: string;
  itemName: string;
  uom: string;
  requiredQty: number;
  allocatedQty: number;
  shortageQty: number;
}

interface PreviewLine {
  productName: string;
  plannedQty: number;
  productionDate: string;
  status: "Ready" | "Shortage";
  materials: PreviewMaterial[];
}

interface DraftLine {
  id: number;
  productName: string;
  qty: string;
  date: string;
}

let nextId = 1;
function blankLine(): DraftLine {
  return { id: nextId++, productName: "", qty: "", date: "" };
}

/**
 * Builds a production plan across several products at once.
 *
 * The products are entered together because that is the only way the material check can
 * be honest: stock is one shared pool, and a per-product check would let two products
 * both come back "Ready" off the same material. The preview shows exactly what
 * submitting will do, because it runs the same allocation.
 */
export default function PlanForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/ppc/products")
      .then((res) => res.json())
      .then((data: { products?: Product[] }) => setProducts(data.products ?? []))
      .catch(() => toast.error("Product list load nahi hui."));
  }, [open]);

  function setLine(id: number, patch: Partial<DraftLine>) {
    // Any edit invalidates the preview — showing a check that no longer matches what is
    // on screen is worse than showing none.
    setPreview(null);
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function reset() {
    setLines([blankLine()]);
    setPreview(null);
  }

  function payload() {
    return lines
      .filter((l) => l.productName && Number(l.qty) > 0 && l.date)
      .map((l) => ({
        productName: l.productName,
        plannedQty: Number(l.qty),
        productionDate: l.date,
      }));
  }

  async function handleCheck() {
    const body = payload();
    if (body.length === 0) {
      toast.error("Product, quantity aur date bharein.");
      return;
    }

    setChecking(true);
    try {
      const res = await fetch("/api/ppc/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Check nahi ho paya.");
        return;
      }
      setPreview(data.lines ?? []);
    } catch {
      toast.error("Check nahi ho paya.");
    } finally {
      setChecking(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = payload();
    if (body.length === 0) {
      toast.error("Product, quantity aur date bharein.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/ppc/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Plan save nahi ho paya.");
        return;
      }

      const short = (data.plans ?? []).filter(
        (p: { status: string }) => p.status === "Shortage"
      ).length;
      toast.success(
        short > 0
          ? `${data.plans.length} plan bane — ${short} me material kam hai, indent raise kar sakte hain.`
          : `${data.plans.length} plan ban gaya, material reserve ho gaya.`
      );
      reset();
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Plan save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Naya plan</Button>} />
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Naya production plan</DialogTitle>
          <DialogDescription>
            Jo product ek saath banane hain, sab yahin daalein. Material ek hi pool se
            baanta jaata hai — pehle wali production date ko pehle milta hai.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            {lines.map((line, i) => (
              <div
                key={line.id}
                className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_10rem_auto]"
              >
                <div className="space-y-2">
                  <Label htmlFor={`product-${line.id}`}>Product {i + 1}</Label>
                  <select
                    id={`product-${line.id}`}
                    value={line.productName}
                    onChange={(e) => setLine(line.id, { productName: e.target.value })}
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  >
                    <option value="">Chunein...</option>
                    {products.map((p) => (
                      <option key={p.productName} value={p.productName}>
                        {p.productName} (v{p.version})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`qty-${line.id}`}>Quantity</Label>
                  <Input
                    id={`qty-${line.id}`}
                    type="number"
                    step="any"
                    min="0"
                    value={line.qty}
                    onChange={(e) => setLine(line.id, { qty: e.target.value })}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`date-${line.id}`}>Production date</Label>
                  <Input
                    id={`date-${line.id}`}
                    type="date"
                    value={line.date}
                    onChange={(e) => setLine(line.id, { date: e.target.value })}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={lines.length === 1}
                    onClick={() => {
                      setPreview(null);
                      setLines((prev) => prev.filter((l) => l.id !== line.id));
                    }}
                  >
                    Hatayein
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
            >
              Ek aur product
            </Button>
          </div>

          {products.length === 0 && (
            <p className="rounded-lg border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
              Kisi bhi product ki active BOM nahi mili. Plan banane ke liye pehle BOM
              banani hogi.
            </p>
          )}

          {preview && (
            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-sm font-medium">Material check</p>
              {preview.map((line) => (
                <div key={`${line.productName}-${line.productionDate}`} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{line.productName}</span>
                    <span className="text-muted-foreground">
                      {line.plannedQty} unit · {line.productionDate}
                    </span>
                    <Badge variant={line.status === "Ready" ? "default" : "destructive"}>
                      {line.status === "Ready" ? "Ready" : "Material kam"}
                    </Badge>
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Chahiye</TableHead>
                          <TableHead className="text-right">Milega</TableHead>
                          <TableHead className="text-right">Kam</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {line.materials.map((m) => (
                          <TableRow key={m.sku}>
                            <TableCell>
                              {m.itemName}
                              <span className="block text-xs text-muted-foreground">
                                {m.sku}
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Material kam hone par bhi plan ban sakta hai — jitna mila utna reserve ho
                jaayega, aur baaki ke liye indent raise kar sakte hain.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCheck}
              disabled={checking || products.length === 0}
            >
              {checking ? "Check ho raha hai..." : "Material check karein"}
            </Button>
            <Button type="submit" disabled={saving || products.length === 0}>
              {saving ? "Ban raha hai..." : "Plan banayein"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
