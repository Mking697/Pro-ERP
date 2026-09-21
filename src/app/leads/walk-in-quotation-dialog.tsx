"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/components/preferences-provider";

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  city: string;
  state: string;
  billingAddress: string;
}

const EMPTY_NEW = {
  customerName: "",
  phone: "",
  email: "",
  gstin: "",
  city: "",
  state: "",
  billingAddress: "",
};

/**
 * A quotation with no Lead behind it — a repeat customer calling in directly. "Existing
 * Customer" is scoped to whoever is quoting's own Customer Master rows (see
 * /api/leads/customers-lookup), not the whole org's book — matches how the user described
 * it: a salesperson builds their own customer list over time. "New Customer" adds one to
 * the master on the spot (createdBy = whoever is quoting) and quotes it immediately.
 */
export default function WalkInQuotationDialog() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [newCustomer, setNewCustomer] = useState(EMPTY_NEW);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/leads/customers-lookup")
      .then((res) => res.json())
      .then((data: { customers?: CustomerOption[] }) => setCustomers(data.customers ?? []))
      .catch(() => toast.error(t("Customers load nahi ho paye.")))
      .finally(() => setLoadingCustomers(false));
  }, [open, t]);

  const matches = customers.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function handleSubmit() {
    if (mode === "existing" && !selectedId) {
      toast.error(t("Ek Customer chunein."));
      return;
    }
    if (mode === "new" && !newCustomer.customerName.trim()) {
      toast.error(t("Customer ka naam zaroori hai."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/leads/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "existing" ? { customerId: selectedId } : { newCustomer }
        ),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Quotation ban nahi paya."));
        return;
      }

      toast.success(t("Quotation ban gaya."));
      setOpen(false);
      setSelectedId("");
      setNewCustomer(EMPTY_NEW);
      router.push(`/leads/quotations/${data.quotation.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">{t("+ Nayi Quotation")}</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Nayi Quotation (bina Lead ke)")}</DialogTitle>
          <DialogDescription>
            {t("Koi purana Customer chunein, ya naya Customer bana kar seedha quotation shuru karein.")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => v && setMode(v as "existing" | "new")}>
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
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {loadingCustomers ? (
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
                    onClick={() => setSelectedId(c.id)}
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
                onChange={(e) => setNewCustomer((c) => ({ ...c, customerName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("Phone")}</Label>
                <Input
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, email: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("City")}</Label>
                <Input
                  value={newCustomer.city}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, city: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("State")}</Label>
                <Input
                  value={newCustomer.state}
                  onChange={(e) => setNewCustomer((c) => ({ ...c, state: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>GSTIN</Label>
              <Input
                value={newCustomer.gstin}
                onChange={(e) => setNewCustomer((c) => ({ ...c, gstin: e.target.value }))}
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : t("Quotation Shuru Karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
