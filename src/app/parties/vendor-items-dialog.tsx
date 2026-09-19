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
import ItemPicker, { type PickerItem } from "@/components/item-picker";
import { useT } from "@/components/preferences-provider";
import { cn } from "@/lib/utils";

interface VendorItem {
  Vendor_Item_ID: string;
  SKU: string;
  Item_Name: string;
  UOM: string;
  Lead_Time_Days: string;
  Unit_Price: string;
}

/**
 * Which SKUs a Purchase Vendor supplies, at what lead time and unit price.
 *
 * This is what the Indent flow reads to suggest a vendor list per item — without it, a
 * vendor is just a name and a bank account, with nothing linking it to what it actually
 * supplies.
 */
export default function VendorItemsDialog({
  vendorId,
  vendorName,
}: {
  vendorId: string;
  vendorName: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<VendorItem[]>([]);
  const [item, setItem] = useState<PickerItem | null>(null);
  const [leadTimeDays, setLeadTimeDays] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // No setLoading(true) here: on a reopen the previous list stays on screen until the
    // fresh data lands, rather than flashing back to a loading state.
    fetch(`/api/parties/vendors/${vendorId}/items`)
      .then((res) => res.json())
      .then((data: { items?: VendorItem[] }) => setRows(data.items ?? []))
      .catch(() => toast.error(t("Vendor ke items load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [open, vendorId, t]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) {
      toast.error(t("Item chunein."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/parties/vendors/${vendorId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: item.sku,
          leadTimeDays: leadTimeDays || undefined,
          unitPrice: unitPrice || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Item link nahi ho paya."));
        return;
      }

      const saved: VendorItem = { ...data.item, Item_Name: item.name, UOM: item.uom };
      setRows((prev) => {
        const rest = prev.filter((r) => r.SKU !== saved.SKU);
        return [...rest, saved];
      });
      toast.success(t("Item vendor se jud gaya."));
      setItem(null);
      setLeadTimeDays("");
      setUnitPrice("");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(row: VendorItem) {
    setBusyId(row.Vendor_Item_ID);
    try {
      const res = await fetch(`/api/parties/vendors/${vendorId}/items/${row.Vendor_Item_ID}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(t("Hata nahi paya."));
        return;
      }
      setRows((prev) => prev.filter((r) => r.Vendor_Item_ID !== row.Vendor_Item_ID));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">{t("Items")}</Button>} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{vendorName} — {t("Items")}</DialogTitle>
          <DialogDescription>
            {t(
              "Ye vendor kaun se item supply karta hai, kitne lead time me, aur kis price par — indent uthate waqt yahi list suggest hogi."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleAdd} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_8rem_auto]">
          <ItemPicker value={item} onChange={setItem} label={t("Item")} />
          <div className="space-y-2">
            <Label htmlFor="leadTimeDays">{t("Lead Time (din)")}</Label>
            <Input
              id="leadTimeDays"
              type="number"
              min="0"
              step="1"
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unitPrice">{t("Unit Price")}</Label>
            <Input
              id="unitPrice"
              type="number"
              min="0"
              step="any"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              className="tabular-nums"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={saving || !item} className="w-full">
              {saving ? "..." : t("Add")}
            </Button>
          </div>
        </form>

        <div className="max-h-[40vh] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Item")}</TableHead>
                <TableHead className="text-right">{t("Lead Time (din)")}</TableHead>
                <TableHead className="text-right">{t("Unit Price")}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    {t("Abhi koi item is vendor se linked nahi hai.")}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow
                  key={row.Vendor_Item_ID}
                  className={cn(
                    "transition-opacity duration-150",
                    busyId === row.Vendor_Item_ID && "opacity-40"
                  )}
                >
                  <TableCell>
                    <span className="block font-medium">{row.Item_Name || row.SKU}</span>
                    <span className="block text-xs text-muted-foreground">{row.SKU}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.Lead_Time_Days || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.Unit_Price || "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyId === row.Vendor_Item_ID}
                      onClick={() => handleRemove(row)}
                    >
                      {t("Hatayein")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("Band karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
