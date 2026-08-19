"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DateRange } from "@/lib/analytics";

/**
 * Time-range controls, in one row above the charts.
 *
 * State lives in the URL rather than in the component, so a filtered view can be
 * bookmarked, shared with a colleague, and reloaded — and so the export link can
 * carry exactly the window that is on screen.
 */
export default function DateRangeFilter({
  active,
  presets,
  from,
  to,
}: {
  active: DateRange;
  presets: readonly { key: string; label: string }[];
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    // Keeps the analytics tab open across a filter change.
    q.set("tab", "analytics");
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.push(`/dashboard?${q.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border p-3">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Button
            key={p.key}
            variant={active.key === p.key ? "default" : "outline"}
            size="sm"
            onClick={() => apply({ range: p.key, from: null, to: null })}
            className={cn(active.key === p.key && "pointer-events-none")}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="from" className="text-xs">
            From
          </Label>
          <Input
            id="from"
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-8 w-36"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to" className="text-xs">
            To
          </Label>
          <Input
            id="to"
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-8 w-36"
          />
        </div>
        <Button
          variant={active.key === "custom" ? "default" : "outline"}
          size="sm"
          disabled={!customFrom || !customTo}
          onClick={() => apply({ range: "custom", from: customFrom, to: customTo })}
        >
          Apply
        </Button>
      </div>

      <p className="ml-auto text-xs text-muted-foreground">
        Dikha raha hai: <span className="font-medium text-foreground">{active.label}</span>
      </p>
    </div>
  );
}
