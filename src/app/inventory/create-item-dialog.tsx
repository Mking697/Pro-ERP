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
import { ITEM_CATEGORIES } from "@/lib/inventory/constants";

const EMPTY = {
  sku: "",
  itemName: "",
  category: "Raw Material",
  sizeUnit: "",
  uom: "PCS",
  rate: "",
  leadTimeDays: "",
  safetyFactor: "1",
  moq: "",
  maxLevel: "",
  location: "",
};

export default function CreateItemDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
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
        toast.error(data?.error ?? "Item ban nahi paya.");
        return;
      }

      toast.success(`${data.item.Item_Name} ban gaya (${data.item.SKU}).`);
      setForm(EMPTY);
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Item ban nahi paya.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Naya Item</Button>} />
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Naya Item</DialogTitle>
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
                placeholder="Khaali chhodenge to bann jaayega"
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
                  {ITEM_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="uom">UOM</Label>
              <Input
                id="uom"
                value={form.uom}
                onChange={(e) => set("uom", e.target.value)}
                placeholder="PCS, KG, M"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sizeUnit">Size / Unit</Label>
              <Input
                id="sizeUnit"
                value={form.sizeUnit}
                onChange={(e) => set("sizeUnit", e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">Planning fields</p>
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
              ).map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>{label}</Label>
                  <Input
                    id={key}
                    type={key === "location" ? "text" : "number"}
                    step="any"
                    min="0"
                    value={form[key]}
                    onChange={(e) => set(key, e.target.value)}
                  />
                </div>
              ))}
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
