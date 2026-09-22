"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/components/preferences-provider";

export interface CustomerOption {
  id: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  city: string;
  state: string;
  billingAddress: string;
}

export interface NewCustomerDraft {
  customerName: string;
  phone: string;
  email: string;
  gstin: string;
  city: string;
  state: string;
  billingAddress: string;
}

export const EMPTY_NEW_CUSTOMER: NewCustomerDraft = {
  customerName: "",
  phone: "",
  email: "",
  gstin: "",
  city: "",
  state: "",
  billingAddress: "",
};

/**
 * Existing/New Customer picker, shared by the Intake mapping dialog and the Direct order
 * form — same UX and scoping (this user's own customers.createdBy rows) as Lead FMS's
 * walk-in-quotation-dialog.tsx, just factored out so both Order FMS entry paths agree on it.
 */
export default function CustomerPicker({
  mode,
  onModeChange,
  selectedId,
  onSelect,
  newCustomer,
  onNewCustomerChange,
}: {
  mode: "existing" | "new";
  onModeChange: (mode: "existing" | "new") => void;
  selectedId: string;
  onSelect: (id: string) => void;
  newCustomer: NewCustomerDraft;
  onNewCustomerChange: (draft: NewCustomerDraft) => void;
}) {
  const t = useT();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/orders/customers-lookup")
      .then((res) => res.json())
      .then((data: { customers?: CustomerOption[] }) => setCustomers(data.customers ?? []))
      .catch(() => toast.error(t("Customers load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  const matches = customers.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <Tabs value={mode} onValueChange={(v) => v && onModeChange(v as "existing" | "new")}>
      <TabsList>
        <TabsTrigger value="existing">{t("Existing Customer")}</TabsTrigger>
        <TabsTrigger value="new">{t("New Customer")}</TabsTrigger>
      </TabsList>

      <TabsContent value="existing" className="space-y-3 pt-3">
        <Input
          placeholder={t("Naam ya phone se search karein...")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {loading ? (
            <p className="p-2 text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
          ) : matches.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              {t("Aapke naam se koi Customer nahi mila — New Customer tab try karein.")}
            </p>
          ) : (
            matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`w-full rounded-md border p-2 text-left text-sm transition-colors duration-150 hover:bg-muted ${
                  selectedId === c.id ? "border-primary bg-muted" : ""
                }`}
              >
                <span className="block font-medium">{c.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {[c.phone, c.city].filter(Boolean).join(" · ") || "—"}
                </span>
              </button>
            ))
          )}
        </div>
      </TabsContent>

      <TabsContent value="new" className="space-y-3 pt-3">
        <div className="space-y-2">
          <Label>{t("Naam")}</Label>
          <Input
            value={newCustomer.customerName}
            onChange={(e) => onNewCustomerChange({ ...newCustomer, customerName: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t("Phone")}</Label>
            <Input
              value={newCustomer.phone}
              onChange={(e) => onNewCustomerChange({ ...newCustomer, phone: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              value={newCustomer.email}
              onChange={(e) => onNewCustomerChange({ ...newCustomer, email: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>{t("City")}</Label>
            <Input
              value={newCustomer.city}
              onChange={(e) => onNewCustomerChange({ ...newCustomer, city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("State")}</Label>
            <Input
              value={newCustomer.state}
              onChange={(e) => onNewCustomerChange({ ...newCustomer, state: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>GSTIN</Label>
          <Input
            value={newCustomer.gstin}
            onChange={(e) => onNewCustomerChange({ ...newCustomer, gstin: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("Billing Address")}</Label>
          <Input
            value={newCustomer.billingAddress}
            onChange={(e) => onNewCustomerChange({ ...newCustomer, billingAddress: e.target.value })}
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
