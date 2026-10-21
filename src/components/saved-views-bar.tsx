"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bookmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/components/preferences-provider";

export interface SavedView<TFilters> {
  id: string;
  name: string;
  filters: TFilters;
  createdAt: string;
}

/**
 * Reusable "Saved Views/Filters" bar (roadmap Phase 3 item #12) — a "Views" dropdown
 * listing this user's own saved filter/search/sort configurations for one `module`
 * ("orders" | "inventory" today, any future board can reuse this with its own string),
 * a "Save current view" action, and a delete icon per saved view.
 *
 * Generic over `TFilters`: each board defines its own exact filters shape (see
 * OrdersBoard's `{ tab }` and InventoryBoard's `{ search, status }`) and hands it to
 * `currentFilters`/receives it back via `onApply` — this component itself never inspects
 * what's inside, it only persists/lists/deletes the opaque blob via `/api/saved-views`.
 *
 * Views are private to the signed-in user (see src/db/schema/savedViews.ts's doc comment)
 * — this component never fetches or shows anyone else's saved views, by design.
 */
export default function SavedViewsBar<TFilters extends object>({
  module,
  currentFilters,
  onApply,
}: {
  module: string;
  currentFilters: TFilters;
  onApply: (filters: TFilters) => void;
}) {
  const t = useT();
  const [views, setViews] = useState<SavedView<TFilters>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetch(`/api/saved-views?module=${encodeURIComponent(module)}`)
      .then((res) => (res.ok ? res.json() : { views: [] }))
      .then((data: { views?: SavedView<TFilters>[] }) => {
        if (active) setViews(data.views ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [module, version]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("View ka naam zaroori hai."));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/saved-views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, name: trimmed, filters: currentFilters }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? t("View save nahi ho payi."));
        return;
      }
      toast.success(t("View save ho gayi."));
      setSaveOpen(false);
      setName("");
      setVersion((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/saved-views/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? t("View delete nahi ho payi."));
        return;
      }
      setViews((prev) => prev.filter((v) => v.id !== id));
      toast.success(t("View delete ho gayi."));
    } catch {
      toast.error(t("View delete nahi ho payi."));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="sm">
              <Bookmark className="size-4" />
              {t("Views")}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("Saved Views")}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {/* Plain divs/buttons, not DropdownMenuItem, for the rows themselves — each row
              needs two independent click targets (apply the view / delete it), and Base
              UI's Menu.Item closes the whole menu on any click inside it by default, which
              would fire "apply" every time someone only meant to hit the delete icon. */}
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto px-1 py-1">
            {loading ? (
              <p className="px-1.5 py-1.5 text-sm text-muted-foreground">
                {t("Load ho raha hai...")}
              </p>
            ) : views.length === 0 ? (
              <p className="px-1.5 py-1.5 text-sm text-muted-foreground">
                {t("Koi saved view nahi hai.")}
              </p>
            ) : (
              views.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-1 rounded-md px-1.5 py-1 hover:bg-accent"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    onClick={() => onApply(v.filters)}
                    title={v.name}
                  >
                    {v.name}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${v.name} ${t("delete karein")}`}
                    onClick={() => handleDelete(v.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setSaveOpen(true)}>
            {t("Current view save karein...")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (!open) setName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("View save karein")}</DialogTitle>
            <DialogDescription>
              {t(
                "Abhi ke filters/search ek naam ke saath save ho jaayenge — dobara ek click me load kar sakte hain."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="saved-view-name">{t("Naam")}</Label>
            <Input
              id="saved-view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Jaise: Dispatch Pending - High Value")}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button type="button" disabled={saving} onClick={handleSave}>
              {saving ? t("Save ho raha hai...") : t("Save Karein")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
