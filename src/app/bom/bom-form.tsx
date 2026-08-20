"use client";

import { useState, type FormEvent } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ItemPicker, { type PickerItem } from "@/components/item-picker";
import { suggestProductSku } from "@/lib/inventory/constants";
import { useT } from "@/components/preferences-provider";

interface DraftLine {
  id: number;
  item: PickerItem | null;
  qty: string;
}

let nextId = 1;
function blankLine(): DraftLine {
  return { id: nextId++, item: null, qty: "" };
}

/**
 * Builds a product's Bill of Materials.
 *
 * Choosing an item fills its SKU and unit automatically — a BOM must never carry a unit
 * the item itself is not measured in, or every shortage calculation built on it is
 * quietly wrong.
 */
export default function BomForm({
  onCreated,
  known = [],
}: {
  onCreated: () => void;
  /** Existing BOMs, so re-planning a known product re-uses its SKU instead of minting one. */
  known?: { productName: string; productSku: string }[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [productSku, setProductSku] = useState("");
  const [skuEdited, setSkuEdited] = useState(false);
  const [lineCount, setLineCount] = useState("");
  // Opens ready to type. Starting empty meant the first thing anyone met was a count box
  // and a "Rows banayein" button — a step to get to the step, before any real work.
  const [lines, setLines] = useState<DraftLine[]>(() => [
    blankLine(),
    blankLine(),
    blankLine(),
  ]);
  const [saving, setSaving] = useState(false);

  // The SKU follows the name until the user types in the box themselves; after that it is
  // theirs and nothing overwrites it.
  function handleNameChange(name: string) {
    setProductName(name);
    if (skuEdited) return;
    const match = known.find(
      (b) => b.productName.trim().toLowerCase() === name.trim().toLowerCase()
    );
    setProductSku(match?.productSku || suggestProductSku(name));
  }

  function buildLines(count: number) {
    const n = Math.max(1, Math.min(count, 100));
    setLines(Array.from({ length: n }, () => blankLine()));
  }

  function setLine(id: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function reset() {
    setProductName("");
    setProductSku("");
    setSkuEdited(false);
    setLineCount("");
    setLines([blankLine(), blankLine(), blankLine()]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const filled = lines.filter((l) => l.item && Number(l.qty) > 0);
    if (filled.length === 0) {
      toast.error(t("Kam se kam ek line me item aur quantity daalein."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/bom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productName,
          productSku,
          lines: filled.map((l) => ({
            componentSku: l.item!.sku,
            componentName: l.item!.name,
            qtyPerUnit: Number(l.qty),
            uom: l.item!.uom,
          })),
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? "BOM save nahi ho payi.");
        return;
      }

      toast.success(
        data.bom.version > 1
          ? `${data.bom.productName} ki BOM version ${data.bom.version} ban gayi — purani archive ho gayi.`
          : `${data.bom.productName} ki BOM ban gayi (${filled.length} items).`
      );
      reset();
      setOpen(false);
      onCreated();
    } catch {
      toast.error(t("BOM save nahi ho payi."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t("Nayi BOM")}</Button>} />
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Nayi BOM")}</DialogTitle>
          <DialogDescription>
            Ek product banane me kaun se item kitne lagte hain. Item chunte hi uska SKU
            aur unit apne aap aa jaayenge — aapko sirf quantity likhni hai.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="productName">{t("Product ka naam")}</Label>
              <Input
                id="productName"
                value={productName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Sliding Door 80mm"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="productSku">Product SKU</Label>
              <Input
                id="productSku"
                value={productSku}
                onChange={(e) => {
                  setSkuEdited(true);
                  setProductSku(e.target.value);
                }}
                placeholder="FG-SLIDING-DOOR-80MM"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {skuEdited
                  ? t("Aapka apna SKU.")
                  : t("Naam se apne aap bana — badal sakte hain.")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lineCount">{t("Ek saath rows")}</Label>
              <div className="flex gap-2">
                <Input
                  id="lineCount"
                  type="number"
                  min="1"
                  max="100"
                  value={lineCount}
                  onChange={(e) => setLineCount(e.target.value)}
                  className="w-28"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => buildLines(Number(lineCount) || 1)}
                >{t("Rows banayein")}</Button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
              {lines.map((line, i) => (
                <div
                  key={line.id}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_auto]"
                >
                  <ItemPicker
                    value={line.item}
                    onChange={(item) => setLine(line.id, { item })}
                    label={`Item ${i + 1}`}
                  />
                  <div className="space-y-2">
                    <Label htmlFor={`qty-${line.id}`}>
                      Qty per unit
                      {line.item && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          {line.item.uom}
                        </span>
                      )}
                    </Label>
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
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                    >{t("Hatayein")}</Button>
                  </div>
                </div>
              ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
            >{t("Ek aur line")}</Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving || lines.length === 0}>
              {saving ? "Saving..." : "BOM banayein"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
