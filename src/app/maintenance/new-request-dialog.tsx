"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import { Wrench } from "lucide-react";
import type { MaintenanceKind, MaintenanceRequestRow } from "./types";

const KINDS: { value: MaintenanceKind; label: string }[] = [
  { value: "Generator_Repair", label: "Generator Repair" },
  { value: "Servicing", label: "Servicing" },
  { value: "Wiring", label: "Wiring" },
  { value: "Light_Change", label: "Light Change" },
  { value: "Other", label: "Other" },
];

/** General (non-Breakdown) maintenance log — no Production Line link, nothing pauses.
 * Closes directly once Maintenance marks it fixed, no reporter confirmation needed. */
export default function NewMaintenanceRequestDialog({
  onCreated,
}: {
  onCreated: (request: MaintenanceRequestRow) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MaintenanceKind>("Servicing");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "Request nahi ban payi."));
        return;
      }
      toast.success(t("Maintenance request ban gayi."));
      onCreated(data.request);
      setOpen(false);
      setDescription("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <Wrench className="size-4" />
            {t("Nayi Request")}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Nayi Maintenance Request")}</DialogTitle>
          <DialogDescription>
            {t("Production Line breakdown ke liye 'Breakdown Report Karein' button use karein.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Kaam ka type")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as MaintenanceKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {t(k.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maintenance-description">{t("Details")}</Label>
            <Textarea
              id="maintenance-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Jaise: Generator ka oil change chahiye...")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? t("Save ho raha hai...") : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
