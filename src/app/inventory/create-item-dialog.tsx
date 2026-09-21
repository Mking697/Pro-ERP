"use client";

import { useState, type FormEvent, type ReactElement } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ITEM_CATEGORIES, COMMON_UOMS, type ItemCategory } from "@/lib/inventory/constants";
import { useT } from "@/components/preferences-provider";
import AutocompleteInput from "@/components/ui/autocomplete-input";

function blank(defaultCategory: ItemCategory, initialSku: string, initialItemName: string) {
  return {
    sku: initialSku,
    itemName: initialItemName,
    category: defaultCategory,
    sizeUnit: "",
    uom: "PCS",
    rate: "",
    leadTimeDays: "",
    safetyFactor: "1",
    moq: "",
    maxLevel: "",
    location: "",
  };
}

export default function CreateItemDialog({
  onCreated,
  defaultCategory = "Raw Material",
  categoryOptions = ITEM_CATEGORIES,
  initialSku = "",
  initialItemName = "",
  trigger,
  uomOptions = [],
  sizeUnitOptions = [],
  locationOptions = [],
}: {
  onCreated: () => void;
  /** The Finished Goods board opens this pre-set to "FG" — nobody adding a product from
   * that screen should have to remember to change the dropdown every time. */
  defaultCategory?: ItemCategory;
  /** The Category dropdown's own choices — scoped per board so picking one that would
   * make the new item vanish from the page it was just created on (e.g. "Raw Material"
   * from the Finished Goods board) isn't even offered. */
  categoryOptions?: readonly ItemCategory[];
  /** Pre-fills SKU/Item Name — used by the "BOM product missing its Item" banner so the
   * Admin never has to retype a SKU by hand. */
  initialSku?: string;
  initialItemName?: string;
  /** Overrides the default "+ Naya Item" trigger button, e.g. for a per-row "+ Add" in
   * that same banner. */
  trigger?: ReactElement;
  /** UOM/Size-Unit values already used elsewhere (usually every other item's own values,
   * passed down by the board that already has them loaded) — merged with a small common
   * base list for UOM. Both fields stay free text; this is autocomplete, not an enum. */
  uomOptions?: string[];
  sizeUnitOptions?: string[];
  locationOptions?: string[];
}) {
  const mergedUomOptions = [...new Set([...COMMON_UOMS, ...uomOptions])].sort();
  const mergedSizeUnitOptions = [...new Set(sizeUnitOptions)].sort();
  const mergedLocationOptions = [...new Set(locationOptions)].sort();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => blank(defaultCategory, initialSku, initialItemName));
  const [saving, setSaving] = useState(false);

  function set<K extends keyof ReturnType<typeof blank>>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Item ban nahi paya."));
        return;
      }

      toast.success(`${data.item.Item_Name} ban gaya (${data.item.SKU}).`);
      setForm(blank(defaultCategory, initialSku, initialItemName));
      setOpen(false);
      onCreated();
    } catch {
      toast.error(t("Item ban nahi paya."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button>{t("Naya Item")}</Button>} />
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Naya Item")}</DialogTitle>
          <DialogDescription>
            Planning ke fields abhi khaali chhod sakte hain — baad me Setup se bhar
            dijiye. Tab tak us item ka reorder point nahi banega.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="itemName">Item Name</Label>
              <Input
                id="itemName"
                value={form.itemName}
                onChange={(e) => set("itemName", e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku">SKU</Label>
              <Input
                id="sku"
                value={form.sku}
                onChange={(e) => set("sku", e.target.value)}
                placeholder={t("Khaali chhodenge to bann jaayega")}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => v && set("category", v)}
              >
                <SelectTrigger id="category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="uom">UOM</Label>
              <AutocompleteInput
                id="uom"
                value={form.uom}
                onChange={(v) => set("uom", v)}
                options={mergedUomOptions}
                placeholder="PCS, KG, M"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sizeUnit">Size / Unit</Label>
              <AutocompleteInput
                id="sizeUnit"
                value={form.sizeUnit}
                onChange={(v) => set("sizeUnit", v)}
                options={mergedSizeUnitOptions}
                placeholder={t("Jaise 8x40mm, 2 inch")}
              />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">{t("Planning fields")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reorder point = ADC × Lead Time × Safety Factor. Teeno bhare hone par hi
              system order suggest kar payega.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["leadTimeDays", "Lead Time (din)"],
                  ["safetyFactor", "Safety Factor"],
                  ["maxLevel", "Max Level"],
                  ["moq", "MOQ"],
                  ["rate", "Rate"],
                  ["location", "Location"],
                ] as const
              ).map(([key, label]) =>
                key === "location" ? (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={key}>{label}</Label>
                    <AutocompleteInput
                      id={key}
                      value={form.location}
                      onChange={(v) => set("location", v)}
                      options={mergedLocationOptions}
                    />
                  </div>
                ) : (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      type="number"
                      step="any"
                      min="0"
                      value={form[key]}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </div>
                )
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Item banayein"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
