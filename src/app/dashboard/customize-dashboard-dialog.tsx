"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LayoutGrid, ChevronDown, ChevronUp } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useT } from "@/components/preferences-provider";
import {
  DASHBOARD_WIDGET_DEFS,
  type DashboardWidgetKey,
  type DashboardWidgetPref,
} from "@/lib/dashboardWidgets";

const LABEL_BY_KEY: Record<DashboardWidgetKey, string> = Object.fromEntries(
  DASHBOARD_WIDGET_DEFS.map((d) => [d.key, d.name])
) as Record<DashboardWidgetKey, string>;

/**
 * "Customize dashboard" entry point — show/hide + up/down reorder for the five dashboard
 * widget blocks (see src/lib/dashboardWidgets.ts for the boundaries/rationale). No
 * drag-and-drop: arrow buttons swap the row with its neighbour, which is all five items
 * need. Saving calls /api/dashboard/widget-prefs then router.refresh() — same
 * save-then-refresh shape as onboarding-checklist.tsx's dismiss flow.
 */
export default function CustomizeDashboardDialog({
  initialPrefs,
}: {
  initialPrefs: DashboardWidgetPref[];
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<DashboardWidgetPref[]>(initialPrefs);
  const [saving, setSaving] = useState(false);

  function changeOpen(next: boolean) {
    if (saving) return;
    if (next) setPrefs(initialPrefs);
    setOpen(next);
  }

  function toggleVisible(key: DashboardWidgetKey) {
    setPrefs((prev) => prev.map((p) => (p.key === key ? { ...p, visible: !p.visible } : p)));
  }

  function move(index: number, direction: -1 | 1) {
    setPrefs((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/widget-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(t(data.error ?? "Save nahi ho paya."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(t("Kuch galat ho gaya. Dobara try karein."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <LayoutGrid aria-hidden="true" className="size-4" />
            {t("Dashboard customize karein")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Dashboard customize karein")}</DialogTitle>
          <DialogDescription>
            {t("Widgets dikhayein/chhupayein, aur arrows se unka order badlein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          {prefs.map((pref, i) => (
            <div
              key={pref.key}
              className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {t(LABEL_BY_KEY[pref.key])}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || saving}
                  aria-label={`${t(LABEL_BY_KEY[pref.key])} — ${t("Upar le jayein")}`}
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => move(i, 1)}
                  disabled={i === prefs.length - 1 || saving}
                  aria-label={`${t(LABEL_BY_KEY[pref.key])} — ${t("Neeche le jayein")}`}
                >
                  <ChevronDown />
                </Button>
                <Switch
                  checked={pref.visible}
                  onCheckedChange={() => toggleVisible(pref.key)}
                  disabled={saving}
                  aria-label={`${t(LABEL_BY_KEY[pref.key])} — ${t("Dikhayein ya chhupayein")}`}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("Save ho raha hai...") : t("Save Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
