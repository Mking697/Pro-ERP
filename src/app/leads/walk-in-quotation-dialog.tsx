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

interface NegotiationLeadOption {
  id: string;
  personName: string;
  companyName: string;
  phone: string;
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
 * The one place a Quotation is started without drilling into a Lead's own detail dialog
 * first (Independent Quotation, 2026-10-19) — one dialog, three ways in: a Negotiation-
 * stage Lead (same business rule createQuotation() already enforces — Quotation sirf
 * Negotiation stage se banti hai), an existing Customer Master row, or a brand-new
 * Customer added on the spot. "Existing Customer"/the Lead list are both scoped to
 * whoever is quoting's own rows (see /api/leads/customers-lookup and the Negotiation-
 * filtered /api/leads call below), not the whole org's book — a salesperson works their
 * own list.
 */
export default function WalkInQuotationDialog() {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"lead" | "existing" | "new">("existing");
  const [leadsList, setLeadsList] = useState<NegotiationLeadOption[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [leadQuery, setLeadQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
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
    fetch("/api/leads?status=Negotiation")
      .then((res) => res.json())
      .then((data: { leads?: NegotiationLeadOption[] }) => setLeadsList(data.leads ?? []))
      .catch(() => toast.error(t("Leads load nahi ho paye.")))
      .finally(() => setLoadingLeads(false));
  }, [open, t]);

  const customerMatches = customers.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const leadMatches = leadsList.filter((l) =>
    `${l.personName} ${l.companyName} ${l.phone}`.toLowerCase().includes(leadQuery.trim().toLowerCase())
  );

  async function handleSubmit() {
    if (mode === "lead" && !selectedLeadId) {
      toast.error(t("Ek Lead chunein."));
      return;
    }
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
      const res =
        mode === "lead"
          ? await fetch(`/api/leads/${selectedLeadId}/quotations`, { method: "POST" })
          : await fetch("/api/leads/quotations", {
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
      setSelectedLeadId("");
      setNewCustomer(EMPTY_NEW);
      router.push(`/leads/quotations/${data.quotation.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t("+ Nayi Quotation")}</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Nayi Quotation")}</DialogTitle>
          <DialogDescription>
            {t(
              "Ek Negotiation-stage Lead chunein, ya ek purana Customer, ya naya Customer bana kar seedha quotation shuru karein."
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => v && setMode(v as "lead" | "existing" | "new")}>
          <TabsList>
            <TabsTrigger value="lead">{t("Lead")}</TabsTrigger>
            <TabsTrigger value="existing">{t("Existing Customer")}</TabsTrigger>
            <TabsTrigger value="new">{t("New Customer")}</TabsTrigger>
          </TabsList>

          <TabsContent value="lead" className="space-y-3 pt-3">
            <Input
              placeholder={t("Naam, company ya phone se search karein...")}
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
              autoComplete="off"
            />
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {loadingLeads ? (
                <p className="p-2 text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
              ) : leadMatches.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  {t(
                    "Koi Negotiation-stage Lead nahi mila — Quotation sirf Negotiation stage ke Lead se ban sakti hai."
                  )}
                </p>
              ) : (
                leadMatches.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setSelectedLeadId(l.id)}
                    className={`w-full rounded-md border p-2 text-left text-sm transition-colors duration-150 hover:bg-muted ${
                      selectedLeadId === l.id ? "border-primary bg-muted" : ""
                    }`}
                  >
                    <span className="block font-medium">{l.companyName || l.personName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[l.companyName ? l.personName : "", l.phone].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </TabsContent>

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
              ) : customerMatches.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  {t("Aapke naam se koi Customer nahi mila — New Customer tab try karein.")}
                </p>
              ) : (
                customerMatches.map((c) => (
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
