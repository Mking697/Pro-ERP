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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { CustomerRow } from "./types";
import { useT } from "@/components/preferences-provider";

function toForm(customer: CustomerRow) {
  return {
    customerName: customer.Customer_Name,
    contactPerson: customer.Contact_Person,
    phone: customer.Phone,
    email: customer.Email,
    gstin: customer.GSTIN,
    billingAddress: customer.Billing_Address,
    shippingAddress: customer.Shipping_Address,
    city: customer.City,
    state: customer.State,
    creditTerms: customer.Credit_Terms,
    creditLimit: customer.Credit_Limit === null ? "" : String(customer.Credit_Limit),
    creditDays: customer.Credit_Days === null ? "" : String(customer.Credit_Days),
  };
}

type FormState = ReturnType<typeof toForm>;

/**
 * Closes the gap orders.ts's own `resolveCustomer()` comment named but never built — until
 * now, the only way to set an existing customer's Credit Limit/Credit Days (the columns
 * Order FMS's Payment_Review gate and the Accounts Credit Risk report both read) was a direct
 * database write. Every other field here was already editable via a direct DB write too;
 * this dialog is the first real edit surface Customer Master has ever had.
 *
 * The caller mounts this with `key={customer?.Customer_ID ?? "closed"}` so React remounts
 * (and re-initializes `form` fresh from the new `customer`) whenever a different row is
 * opened, rather than syncing it via a `useEffect` — this project's lint config
 * (`react-hooks/set-state-in-effect`) rejects that usual "reset state when a prop changes"
 * pattern, and a remount is simpler anyway.
 */
export default function EditCustomerDialog({
  customer,
  open,
  onOpenChange,
  onUpdated,
}: {
  customer: CustomerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (customer: CustomerRow) => void;
}) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<FormState | null>(() => (customer ? toForm(customer) : null));

  function field(key: keyof FormState) {
    return {
      value: form?.[key] ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => (f ? { ...f, [key]: e.target.value } : f)),
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customer || !form) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/parties/customers/${encodeURIComponent(customer.Customer_ID)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          creditLimit: form.creditLimit.trim() === "" ? null : Number(form.creditLimit),
          creditDays: form.creditDays.trim() === "" ? null : Number(form.creditDays),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Customer update nahi ho paya."));
        return;
      }

      toast.success(t("Customer update ho gaya."));
      onUpdated(data.customer);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Customer Edit Karein")}</DialogTitle>
          <DialogDescription>
            {t("Credit Limit aur Credit Days yahan set karein — Order FMS ka Payment_Review gate aur Accounts ka Credit Risk report inhi do fields se kaam karte hain.")}
          </DialogDescription>
        </DialogHeader>
        {form && (
          <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="space-y-2">
              <Label htmlFor="edit-customerName">{t("Customer Name")}</Label>
              <Input id="edit-customerName" {...field("customerName")} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-contactPerson">{t("Contact Person")}</Label>
                <Input id="edit-contactPerson" {...field("contactPerson")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">{t("Phone")}</Label>
                <Input id="edit-phone" {...field("phone")} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" {...field("email")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-gstin">GSTIN</Label>
                <Input id="edit-gstin" {...field("gstin")} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-billingAddress">{t("Billing Address")}</Label>
              <Textarea id="edit-billingAddress" rows={2} {...field("billingAddress")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-shippingAddress">{t("Shipping Address")}</Label>
              <Textarea id="edit-shippingAddress" rows={2} {...field("shippingAddress")} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-city">{t("City")}</Label>
                <Input id="edit-city" {...field("city")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-state">{t("State")}</Label>
                <Input id="edit-state" {...field("state")} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-creditTerms">{t("Credit Terms")}</Label>
              <Input id="edit-creditTerms" placeholder={t("Jaise: Net 15")} {...field("creditTerms")} />
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
              <div className="col-span-2 -mt-1 text-xs text-muted-foreground">
                {t("Khaali chhodein toh is customer ko koi credit nahi mila hoga — naya order advance maangega.")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-creditLimit">{t("Credit Limit")} (₹)</Label>
                <Input id="edit-creditLimit" type="number" min="0" step="1" {...field("creditLimit")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-creditDays">{t("Credit Days")}</Label>
                <Input id="edit-creditDays" type="number" min="0" step="1" {...field("creditDays")} />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : t("Save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
