"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";

export interface PickerItem {
  sku: string;
  name: string;
  uom: string;
  sizeUnit: string;
  category: string;
}

/**
 * Type-to-search item picker.
 *
 * Matches on name, SKU and size together and ranks a prefix hit above a substring one,
 * because people type the start of what they are looking for. Deliberately not a plain
 * `<select>`: an item master runs to hundreds of rows, where scrolling a dropdown is
 * slower than typing three letters.
 *
 * The chosen item's SKU and UOM are handed back to the caller — a BOM or an inward entry
 * must never carry a unit the item itself is not measured in.
 */
export default function ItemPicker({
  value,
  onChange,
  label = "Item",
  required = false,
}: {
  value: PickerItem | null;
  onChange: (item: PickerItem | null) => void;
  label?: string;
  required?: boolean;
}) {
  const t = useT();
  const [items, setItems] = useState<PickerItem[]>([]);
  const [configured, setConfigured] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/inventory/lookup")
      .then((res) => res.json())
      .then((data: { items?: PickerItem[]; configured?: boolean }) => {
        setItems(data.items ?? []);
        setConfigured(data.configured !== false);
      })
      .catch(() => setConfigured(false));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);

    const scored = items
      .map((item) => {
        const haystack = `${item.name} ${item.sku} ${item.sizeUnit}`.toLowerCase();
        const at = haystack.indexOf(q);
        if (at === -1) return null;
        // Earlier match ranks higher, so "big" surfaces "Big Rib" before "Rib Big".
        return { item, score: at };
      })
      .filter((m): m is { item: PickerItem; score: number } => m !== null)
      .sort((a, b) => a.score - b.score);

    return scored.slice(0, 8).map((m) => m.item);
  }, [items, query]);

  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{value.name}</span>
            <span className="block text-xs text-muted-foreground">
              {value.sku} · {value.uom}
              {value.sizeUnit && ` · ${value.sizeUnit}`}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >{t("Badlein")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="item-search">{label}</Label>
      <div className="relative">
        <Input
          id="item-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={configured ? "Naam ya SKU type karein..." : t("Items sheet connect nahi hai")}
          disabled={!configured}
          required={required}
          autoComplete="off"
        />

        {open && matches.length > 0 && (
          <ul className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
            {matches.map((item) => (
              <li key={item.sku}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="block font-medium">{item.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {item.sku} · {item.uom}
                    {item.sizeUnit && ` · ${item.sizeUnit}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!configured && (
        <p className="text-xs text-muted-foreground">
          Item master abhi connect nahi hua — is entry ka stock apne aap nahi badhega.
        </p>
      )}
      {configured && query && matches.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("Koi item nahi mila.")}</p>
      )}
    </div>
  );
}
