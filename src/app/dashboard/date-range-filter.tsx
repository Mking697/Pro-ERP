"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DateRange } from "@/lib/analytics";
import type { ReportScope } from "@/lib/reports";
import { useT } from "@/components/preferences-provider";

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
  scope,
  canSeeEveryone = false,
}: {
  active: DateRange;
  presets: readonly { key: string; label: string }[];
  from?: string;
  to?: string;
  /** Whose work the report is showing. Omitted where the choice does not apply. */
  scope?: ReportScope;
  /** Whether this reader may look past their own work at all. */
  canSeeEveryone?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const t = useT();
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");

  function apply(next: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    // The tab parameter only means anything on the dashboard, which is where this control
    // started life. Every report now has its own page, and pushing them all to /dashboard
    // meant changing the date on a report threw the reader back to the dashboard — the
    // filter navigated away from the very thing it was filtering.
    if (pathname === "/dashboard") q.set("tab", "analytics");

    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.push(`${pathname}?${q.toString()}`);
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

      {/* Only offered to someone who may actually see past their own work — for everybody
          else there is one possible answer, and a control with one answer is a puzzle. */}
      {scope && canSeeEveryone && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "mine", label: "Mera kaam" },
              { key: "all", label: "Poora organization" },
            ] as const
          ).map((option) => (
            <Button
              key={option.key}
              variant={scope === option.key ? "default" : "outline"}
              size="sm"
              onClick={() => apply({ scope: option.key })}
              className={cn(scope === option.key && "pointer-events-none")}
            >
              {t(option.label)}
            </Button>
          ))}
        </div>
      )}

      <p className="ml-auto text-xs text-muted-foreground">
        Dikha raha hai: <span className="font-medium text-foreground">{active.label}</span>
        {scope === "mine" && <> · {t("sirf aapka kaam")}</>}
      </p>
    </div>
  );
}
