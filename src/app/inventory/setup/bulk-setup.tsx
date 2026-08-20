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
import type { ItemRow } from "../types";

const FIELDS = [
  { key: "Lead_Time_Days", label: "Lead Time", hint: "din" },
  { key: "Safety_Factor", label: "Safety Factor", hint: "×" },
  { key: "Max_Level", label: "Max Level", hint: "" },
  { key: "MOQ", label: "MOQ", hint: "" },
  { key: "ADC_Manual", label: "ADC (manual)", hint: "/din" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type Draft = Record<string, Partial<Record<FieldKey, string>>>;

/**
 * Fills the planning fields across many items at once.
 *
 * The reorder maths is inert until Lead Time, Safety Factor and Max Level are set, and
 * an item master runs to hundreds of rows — doing this one dialog at a time is not
 * realistic, and leaving it undone is exactly what made the user's previous system never
 * suggest a reorder. So incomplete items are shown first by default.
 *
 * Only edited cells are sent, and only for rows actually touched, so saving cannot
 * overwrite a name or category someone changed while this grid was open.
 */
export default function BulkSetup() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/inventory/items")
      .then((res) => res.json())
      .then((data: { items?: ItemRow[] }) => setItems(data.items ?? []))
      .catch(() => toast.error("Items load nahi ho paye."))
      .finally(() => setLoading(false));
  }, []);

  function edit(sku: string, field: FieldKey, value: string) {
    setDraft((d) => ({ ...d, [sku]: { ...d[sku], [field]: value } }));
  }

  function currentValue(item: ItemRow, field: FieldKey): string {
    const edited = draft[item.SKU]?.[field];
    return edited !== undefined ? edited : (item[field] ?? "");
  }

  const dirtyCount = Object.keys(draft).length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      // A row being edited stays visible even once it no longer matches the filter,
      // so a value does not vanish mid-keystroke.
      const isDirty = draft[i.SKU] !== undefined;
      if (onlyIncomplete && i.missingFields.length === 0 && !isDirty) return false;
      if (!q) return true;
      return (
        i.Item_Name.toLowerCase().includes(q) || i.SKU.toLowerCase().includes(q)
      );
    });
  }, [items, draft, onlyIncomplete, search]);

  const incompleteCount = items.filter((i) => i.missingFields.length > 0).length;

  async function save() {
    const updates = Object.entries(draft).map(([sku, fields]) => {
      const payload: Record<string, string | number | null> = { sku };
      for (const [key, value] of Object.entries(fields)) {
        payload[key] = value.trim() === "" ? null : Number(value);
      }
      return payload;
    });

    setSaving(true);
    try {
      const res = await fetch("/api/inventory/items/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? "Save nahi ho paya.");
        return;
      }

      toast.success(`${data.updated} item update ho gaye.`);
      if (data.unknownSkus?.length) {
        toast.error(`Ye SKU nahi mile: ${data.unknownSkus.join(", ")}`);
      }

      setDraft({});
      const refreshed = await fetch("/api/inventory/items").then((r) => r.json());
      setItems(refreshed.items ?? []);
    } catch {
      toast.error("Save nahi ho paya.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>;
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Abhi koi item nahi hai. Pehle Inventory se item banayein.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          render={<Link href="/inventory">Inventory</Link>}
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
          placeholder="Item ya SKU..."
          className="h-9 max-w-xs"
        />
        <Button
          size="sm"
          variant={onlyIncomplete ? "default" : "outline"}
          onClick={() => setOnlyIncomplete((v) => !v)}
        >
          Sirf adhoore
          <span className="ml-1.5 tabular-nums opacity-70">{incompleteCount}</span>
        </Button>
        <span className="text-sm text-muted-foreground">
          {visible.length} / {items.length} dikh rahe hain
        </span>

        <div className="ml-auto flex items-center gap-2">
          {dirtyCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDraft({})} disabled={saving}>
              Reset
            </Button>
          )}
          <Button onClick={save} disabled={saving || dirtyCount === 0}>
            {saving ? "Saving..." : `Save${dirtyCount ? ` (${dirtyCount})` : ""}`}
          </Button>
        </div>
      </div>

      <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        Reorder point = <strong className="text-foreground">ADC × Lead Time × Safety
        Factor</strong>. Teeno bhare bina system us item ke liye order suggest nahi
        karega. ADC khaali chhodenge to wo Out entries se khud nikal aayega — sirf tab
        bharein jab aap uska number khud tay karna chahte hain.
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-56">Item</TableHead>
              {FIELDS.map((f) => (
                <TableHead key={f.key} className="min-w-28">
                  {f.label}
                  {f.hint && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {f.hint}
                    </span>
                  )}
                </TableHead>
              ))}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={FIELDS.length + 2} className="py-10 text-center text-muted-foreground">
                  {onlyIncomplete
                    ? "Sab items ke planning fields bhare hue hain."
                    : "Koi item nahi mila."}
                </TableCell>
              </TableRow>
            )}
            {visible.map((item) => {
              const isDirty = draft[item.SKU] !== undefined;
              return (
                <TableRow key={item.SKU} className={isDirty ? "bg-muted/40" : undefined}>
                  <TableCell>
                    <span className="block font-medium">{item.Item_Name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {item.SKU} · {item.UOM}
                    </span>
                  </TableCell>

                  {FIELDS.map((f) => (
                    <TableCell key={f.key}>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={currentValue(item, f.key)}
                        onChange={(e) => edit(item.SKU, f.key, e.target.value)}
                        className="h-8 tabular-nums"
                        aria-label={`${item.Item_Name} — ${f.label}`}
                      />
                    </TableCell>
                  ))}

                  <TableCell>
                    {item.missingFields.length === 0 ? (
                      <Badge variant="default">Poora</Badge>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title={item.missingFields.join(", ")}
                      >
                        {item.missingFields.join(", ")}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
