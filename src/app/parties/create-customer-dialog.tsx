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
import { Checkbox } from "@/components/ui/checkbox";
import type { CustomerRow } from "./types";
import { useT } from "@/components/preferences-provider";

const EMPTY = {
  customerName: "",
  contactPerson: "",
  phone: "",
  email: "",
  gstin: "",
  billingAddress: "",
  shippingAddress: "",
  city: "",
  state: "",
  creditTerms: "",
};

export default function CreateCustomerDialog({
  onCreated,
}: {
  onCreated: (customer: CustomerRow) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [sameAsBilling, setSameAsBilling] = useState(true);

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
      const res = await fetch("/api/parties/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          shippingAddress: sameAsBilling ? form.billingAddress : form.shippingAddress,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Customer ban nahi paya."));
        return;
      }

      toast.success(t("Customer ban gaya."));
      if (data.warning) toast.warning(t(data.warning));
      onCreated(data.customer);
      setForm(EMPTY);
      setSameAsBilling(true);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ {t("Add Customer")}</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Naya Customer")}</DialogTitle>
          <DialogDescription>
            {t("Sirf Customer Name zaroori hai — baaki details baad me bhi bhari ja sakti hain.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="customerName">{t("Customer Name")}</Label>
            <Input id="customerName" {...field("customerName")} required />
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
            <Label htmlFor="billingAddress">{t("Billing Address")}</Label>
            <Textarea id="billingAddress" rows={2} {...field("billingAddress")} />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={sameAsBilling}
                onCheckedChange={(checked) => setSameAsBilling(checked === true)}
              />
              {t("Shipping address billing jaisa hi hai")}
            </label>
            {!sameAsBilling && (
              <div className="space-y-2">
                <Label htmlFor="shippingAddress">{t("Shipping Address")}</Label>
                <Textarea id="shippingAddress" rows={2} {...field("shippingAddress")} />
              </div>
            )}
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

          <div className="space-y-2">
            <Label htmlFor="creditTerms">{t("Credit Terms")}</Label>
            <Input id="creditTerms" placeholder={t("Jaise: Net 15")} {...field("creditTerms")} />
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
