"use client";

import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/preferences-provider";
import { UserPlus } from "lucide-react";

export type FieldTaskType = "SERVICE" | "COMPLAINT" | "SITE_VISIT";

const API_BASE: Record<FieldTaskType, string> = {
  SERVICE: "/api/services",
  COMPLAINT: "/api/complaints",
  SITE_VISIT: "/api/site-visits",
};

interface DoerOption {
  id: string;
  fullName: string;
  role: string;
  occupied: { label: string }[];
}

/**
 * Shared Doer-assignment dialog for Services/Complaints/Site Visits — mirrors the
 * reference app's own AssignDoersModal, rebuilt against this app's Dialog/Checkbox
 * primitives. Reopening a Completed task (a fresh round) goes through this exact same
 * dialog/endpoint — src/lib/fieldService/assignments.ts's assignDoers() decides whether
 * it's a first assignment or a reopen.
 */
export default function AssignDoersDialog({
  taskType,
  taskId,
  cycle,
  trigger,
  onAssigned,
  reopening = false,
  assignedDoerIds = [],
}: {
  taskType: FieldTaskType;
  taskId: string;
  cycle: number;
  reopening?: boolean;
  assignedDoerIds?: string[];
  trigger?: React.ReactElement;
  onAssigned: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [doers, setDoers] = useState<DoerOption[]>([]);
  const [loadingDoers, setLoadingDoers] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [fundAmount, setFundAmount] = useState("");
  const [fundNotes, setFundNotes] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/field-service/doers", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Doers load nahi ho paye.");
        return res.json();
      })
      .then((data: { doers?: DoerOption[] }) => {
        if (!controller.signal.aborted) setDoers(data.doers ?? []);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoadingDoers(false); });
    return () => controller.abort();
  }, [open, loadVersion]);

  function changeOpen(next: boolean) {
    if (saving) return;
    if (next) {
      setSelected([]); setFundAmount(""); setFundNotes("");
      setLoadingDoers(true); setLoadError(false); setDoers([]);
    }
    setOpen(next);
  }

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((d) => d !== id)));
  }

  async function handleSubmit() {
    if (selected.length === 0) {
      toast.error(t("Kam se kam ek Doer chunna zaroori hai."));
      return;
    }
    if (saving || loadingDoers || loadError) return;
    if (fundAmount && (!Number.isFinite(Number(fundAmount)) || Number(fundAmount) < 0)) {
      toast.error(t("Fund amount valid hona chahiye.")); return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE[taskType]}/${taskId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycle,
          doerIds: selected,
          fundAmount: fundAmount ? Number(fundAmount) : null,
          fundNotes,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Assign nahi ho paya."));
        return;
      }
      toast.success(t("Doer assign ho gaye."));
      setOpen(false);
      setSelected([]);
      setFundAmount("");
      setFundNotes("");
      onAssigned();
    } catch (error) {
      toast.error(t(error instanceof Error ? error.message : "Assign nahi ho paya."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button variant="outline" size="sm">
              <UserPlus aria-hidden="true" className="size-4" />
              {reopening ? t("Reopen & Assign Doers") : t("Doer Assign Karein")}
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reopening ? t("Reopen & Assign Doers") : t("Doer Assign Karein")}</DialogTitle>
          <DialogDescription>
            {reopening ? t("Reopen starts a new cycle. Previous evidence stays unchanged.") : t("Ek ya zyada Doer chunein — chahein toh unhe cash advance (fund) bhi de sakte hain.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
            {loadError ? (
              <div role="alert" className="space-y-2 p-2 text-sm">
                <p>{t("Doers load nahi ho paye.")}</p>
                <Button variant="outline" size="sm" onClick={() => { setLoadError(false); setLoadingDoers(true); setLoadVersion((v) => v + 1); }}>{t("Retry")}</Button>
              </div>
            ) : loadingDoers ? (
              <p className="p-2 text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
            ) : doers.filter((d) => !assignedDoerIds.includes(d.id)).length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">{t("Koi Active user nahi mila.")}</p>
            ) : (
              doers.filter((d) => !assignedDoerIds.includes(d.id)).map((d) => (
                <label
                  key={d.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors duration-150 hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selected.includes(d.id)}
                    onCheckedChange={(next) => toggle(d.id, next === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight">{d.fullName}</span>
                    <span className="block text-xs leading-tight text-muted-foreground">
                      {d.occupied.length > 0
                        ? t("Occupied: ") + d.occupied.map((o) => o.label).join(", ")
                        : t("Free hai")}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Fund Advance (₹)")}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Fund Notes")}</Label>
              <Input value={fundNotes} onChange={(e) => setFundNotes(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving || loadingDoers || loadError || selected.length === 0}>
            {saving ? t("Assign ho raha hai...") : reopening ? t("Reopen & Assign Doers") : t("Assign Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
