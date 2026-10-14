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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import { Plus } from "lucide-react";
import CustomerSelect, { type FieldCustomerOption } from "@/components/field-service/customer-select";
import LocationPicker, { type LatLng } from "@/components/location-picker";
import { VISIT_FOR_LABEL, type SiteVisitRow } from "./types";

const RAISED_VIA_OPTIONS = ["Phone Call", "WhatsApp", "Email", "In Person", "Other"];

export default function CreateSiteVisitDialog({ onCreated }: { onCreated: (visit: SiteVisitRow) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<FieldCustomerOption | null>(null);
  const [raisedVia, setRaisedVia] = useState("Phone Call");
  const [raisedByName, setRaisedByName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [attendantName, setAttendantName] = useState("");
  const [attendantPhone, setAttendantPhone] = useState("");
  const [visitFor, setVisitFor] = useState<SiteVisitRow["visitFor"]>("Other");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCustomer(null);
    setRaisedVia("Phone Call");
    setRaisedByName("");
    setSiteAddress("");
    setCoords(null);
    setAttendantName("");
    setAttendantPhone("");
    setVisitFor("Other");
  }

  async function handleSubmit() {
    if (!customer) {
      toast.error(t("Customer chunna zaroori hai."));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/site-visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          raisedVia,
          raisedByName,
          siteAddress,
          siteLatitude: coords?.lat ?? null,
          siteLongitude: coords?.lng ?? null,
          attendantName,
          attendantPhone,
          visitFor,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.visit) {
        toast.error(t(data?.error ?? "Site Visit nahi bani."));
        return;
      }
      toast.success(t("Site Visit ban gayi."));
      onCreated(data.visit);
      setOpen(false);
      reset();
    } catch {
      toast.error(t("Site Visit nahi bani."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) { setOpen(next); if (!next) reset(); } }}>
      <DialogTrigger
        render={
          <Button>
            <Plus aria-hidden="true" className="size-4" />
            {t("Nayi Site Visit")}
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Nayi Site Visit")}</DialogTitle>
          <DialogDescription>{t("Customer Master se customer chunein aur visit details bharein.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Customer")}</Label>
            <CustomerSelect selectedId={customer?.id ?? ""} onSelect={setCustomer} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Raised Via")}</Label>
              <Select value={raisedVia} onValueChange={(v) => v && setRaisedVia(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RAISED_VIA_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {t(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Visit For")}</Label>
              <Select value={visitFor} onValueChange={(v) => setVisitFor(v as typeof visitFor)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VISIT_FOR_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("Raised By (naam)")}</Label>
            <Input value={raisedByName} onChange={(e) => setRaisedByName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Site Address")}</Label>
            <Input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("Site Location (map pe pin karein)")}</Label>
            <LocationPicker value={coords} onChange={setCoords} autoLocate={false} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Attendant Name")}</Label>
              <Input value={attendantName} onChange={(e) => setAttendantName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Attendant Phone")}</Label>
              <Input value={attendantPhone} onChange={(e) => setAttendantPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? t("Save ho raha hai...") : t("Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
