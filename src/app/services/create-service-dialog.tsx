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
import { useT } from "@/components/preferences-provider";
import { Plus } from "lucide-react";
import CustomerSelect, { type FieldCustomerOption } from "@/components/field-service/customer-select";
import type { ServiceJobRow } from "./types";

export default function CreateServiceJobDialog({ onCreated }: { onCreated: (job: ServiceJobRow) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<FieldCustomerOption | null>(null);
  const [productDetails, setProductDetails] = useState("");
  const [brand, setBrand] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [attendantName, setAttendantName] = useState("");
  const [attendantPhone, setAttendantPhone] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCustomer(null);
    setProductDetails("");
    setBrand("");
    setSiteAddress("");
    setAttendantName("");
    setAttendantPhone("");
  }

  async function handleSubmit() {
    if (!customer) {
      toast.error(t("Customer chunna zaroori hai."));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          productDetails,
          brand,
          siteAddress,
          attendantName,
          attendantPhone,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.job) {
        toast.error(t(data?.error ?? "Service job nahi bani."));
        return;
      }
      toast.success(t("Service job ban gayi."));
      onCreated(data.job);
      setOpen(false);
      reset();
    } catch {
      toast.error(t("Service job nahi bani."));
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
            {t("Nayi Service Job")}
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Nayi Service Job")}</DialogTitle>
          <DialogDescription>{t("Customer Master se customer chunein aur job details bharein.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Customer")}</Label>
            <CustomerSelect selectedId={customer?.id ?? ""} onSelect={setCustomer} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Product Details")}</Label>
              <Input value={productDetails} onChange={(e) => setProductDetails(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Brand")}</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("Site Address")}</Label>
            <Input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
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
