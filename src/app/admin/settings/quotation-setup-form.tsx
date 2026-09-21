"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface QuotationSetup {
  companyName: string;
  companyAddress: string;
  companyGstin: string;
  bankBeneficiary: string;
  bankName: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankBranch: string;
  defaultSubject: string;
  defaultNote: string;
  defaultTerms: string;
  gstPercent: number;
  numberPrefix: string;
  numberStart: number;
  validityDays: number;
}

const DEFAULT_SETUP: QuotationSetup = {
  companyName: "",
  companyAddress: "",
  companyGstin: "",
  bankBeneficiary: "",
  bankName: "",
  bankAccountNo: "",
  bankIfsc: "",
  bankBranch: "",
  defaultSubject: "",
  defaultNote: "",
  defaultTerms: "",
  gstPercent: 18,
  numberPrefix: "QN",
  numberStart: 1,
  validityDays: 15,
};

/**
 * The Admin's one-time "Quotation Setup" — letterhead (company/bank details, since
 * `organizations` itself carries no address/GSTIN/bank fields) and the defaults a new
 * quotation is seeded with. Mirrors purchase-setup-form.tsx's shape. The org's own logo
 * (Module 10, set separately above on this page) is reused automatically on the PDF —
 * there is deliberately no second logo upload here.
 */
export default function QuotationSetupForm() {
  const t = useT();
  const [setup, setSetup] = useState<QuotationSetup>(DEFAULT_SETUP);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/quotation-setup")
      .then((res) => res.json())
      .then((data: { setup?: QuotationSetup }) => {
        if (data.setup) setSetup(data.setup);
      })
      .catch(() => toast.error(t("Quotation Setup load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/quotation-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("Quotation Setup save ho gaya."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <FormSkeleton fields={6} label={t("Quotation Setup load ho raha hai")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Quotation — Setup")}</CardTitle>
        <CardDescription>
          {t(
            "Quotation PDF ke letterhead aur defaults — company/bank details, subject/note/terms, GST%, aur quotation number series."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Company Details</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input
                value={setup.companyName}
                onChange={(e) => setSetup((s) => ({ ...s, companyName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>GSTIN</Label>
              <Input
                value={setup.companyGstin}
                onChange={(e) => setSetup((s) => ({ ...s, companyGstin: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Textarea
              rows={2}
              value={setup.companyAddress}
              onChange={(e) => setSetup((s) => ({ ...s, companyAddress: e.target.value }))}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Bank Details</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Beneficiary Name</Label>
              <Input
                value={setup.bankBeneficiary}
                onChange={(e) => setSetup((s) => ({ ...s, bankBeneficiary: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Bank Name</Label>
              <Input
                value={setup.bankName}
                onChange={(e) => setSetup((s) => ({ ...s, bankName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Account No</Label>
              <Input
                value={setup.bankAccountNo}
                onChange={(e) => setSetup((s) => ({ ...s, bankAccountNo: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>IFSC</Label>
              <Input
                value={setup.bankIfsc}
                onChange={(e) => setSetup((s) => ({ ...s, bankIfsc: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Branch</Label>
              <Input
                value={setup.bankBranch}
                onChange={(e) => setSetup((s) => ({ ...s, bankBranch: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">Quotation Defaults</p>
          <div className="space-y-2">
            <Label>Default Subject</Label>
            <Input
              value={setup.defaultSubject}
              onChange={(e) => setSetup((s) => ({ ...s, defaultSubject: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Default Note</Label>
            <Textarea
              rows={2}
              value={setup.defaultNote}
              onChange={(e) => setSetup((s) => ({ ...s, defaultNote: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Default Terms & Conditions</Label>
            <Textarea
              rows={5}
              value={setup.defaultTerms}
              onChange={(e) => setSetup((s) => ({ ...s, defaultTerms: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Default GST %</Label>
              <Input
                type="number"
                step="any"
                min="0"
                max="100"
                value={setup.gstPercent}
                onChange={(e) => setSetup((s) => ({ ...s, gstPercent: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Valid For (Days)</Label>
              <Input
                type="number"
                min="1"
                value={setup.validityDays}
                onChange={(e) => setSetup((s) => ({ ...s, validityDays: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Number Prefix</Label>
              <Input
                value={setup.numberPrefix}
                onChange={(e) => setSetup((s) => ({ ...s, numberPrefix: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Starting Number</Label>
              <Input
                type="number"
                min="1"
                value={setup.numberStart}
                onChange={(e) => setSetup((s) => ({ ...s, numberStart: Number(e.target.value) }))}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Pehla quotation number")}: {setup.numberPrefix}-{String(setup.numberStart).padStart(4, "0")}
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
