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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";
import type { TransportVendorRow } from "./types";

const EMPTY = {
  vendorName: "",
  contactPerson: "",
  phone: "",
  email: "",
  gstin: "",
  address: "",
  city: "",
  state: "",
};

export default function CreateTransportVendorDialog({
  onCreated,
}: {
  onCreated: (vendor: TransportVendorRow) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function field(key: keyof typeof EMPTY) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/tms/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Transport Vendor ban nahi paya."));
        return;
      }

      toast.success(t("Transport Vendor ban gaya."));
      if (data.warning) toast.warning(t(data.warning));
      onCreated(data.vendor);
      setForm(EMPTY);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ {t("Add Transport Vendor")}</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Naya Transport Vendor")}</DialogTitle>
          <DialogDescription>
            {t("Sirf Vendor Name zaroori hai, baaki details baad me bhi bhari ja sakti hain.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="vendorName">{t("Vendor Name")}</Label>
            <Input id="vendorName" {...field("vendorName")} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="contactPerson">{t("Contact Person")}</Label>
              <Input id="contactPerson" {...field("contactPerson")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t("Phone")}</Label>
              <Input id="phone" {...field("phone")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...field("email")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input id="gstin" {...field("gstin")} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">{t("Address")}</Label>
            <Textarea id="address" rows={2} {...field("address")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="city">{t("City")}</Label>
              <Input id="city" {...field("city")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">{t("State")}</Label>
              <Input id="state" {...field("state")} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting..." : t("Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
