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
import { Textarea } from "@/components/ui/textarea";
import { qty, type ItemRow } from "./types";

/**
 * Records one In or Out against a single item.
 *
 * The dialog shows free stock right next to the quantity field, and blocks an Out
 * larger than it before the request is sent. The server refuses it too — this check
 * is only here so the person finds out while they are still typing, rather than after
 * a round trip.
 */
export default function StockMovementDialog({
  item,
  direction,
  onDone,
}: {
  item: ItemRow;
  direction: "In" | "Out";
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [issuedTo, setIssuedTo] = useState("");
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

  const entered = Number(quantity);
  const isOut = direction === "Out";
  const tooMuch = isOut && Number.isFinite(entered) && entered > item.free;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooMuch) return;

    setSaving(true);
    try {
      const res = await fetch("/api/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: item.SKU,
          direction,
          quantity: entered,
          issuedTo,
          remark,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error ?? "Entry save nahi ho payi.");
        return;
      }

      toast.success(
        `${item.Item_Name}: ${quantity} ${item.UOM} ${isOut ? "nikala" : "jama"} gaya.`
      );
      setQuantity("");
      setIssuedTo("");
      setRemark("");
      setOpen(false);
      onDone();
    } catch {
      toast.error("Entry save nahi ho payi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isOut ? "outline" : "default"} size="sm">
            {isOut ? "Out" : "In"}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isOut ? "Stock Out" : "Stock In"} — {item.Item_Name}
          </DialogTitle>
          <DialogDescription>
            {item.SKU} · abhi free stock{" "}
            <strong>
              {qty(item.free)} {item.UOM}
            </strong>
            {item.committed > 0 && ` (${qty(item.committed)} ${item.UOM} reserved hai)`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quantity">Quantity ({item.UOM})</Label>
            <Input
              id="quantity"
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
              autoFocus
            />
            {tooMuch && (
              <p className="text-sm text-destructive">
                Free stock sirf {qty(item.free)} {item.UOM} hai — isse zyada nahi nikal
                sakte.
              </p>
            )}
          </div>

          {isOut && (
            <div className="space-y-2">
              <Label htmlFor="issuedTo">Kisko diya</Label>
              <Input
                id="issuedTo"
                value={issuedTo}
                onChange={(e) => setIssuedTo(e.target.value)}
                placeholder="Department, machine, ya vyakti"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="remark">Remark</Label>
            <Textarea
              id="remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving || tooMuch}>
              {saving ? "Saving..." : isOut ? "Stock nikaalein" : "Stock jama karein"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
