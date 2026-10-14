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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUploadField from "@/components/file-upload-field";
import { useT } from "@/components/preferences-provider";
import { Plus } from "lucide-react";
import CustomerSelect, { type FieldCustomerOption } from "@/components/field-service/customer-select";
import type { ComplaintRow } from "./types";

export default function CreateComplaintDialog({ onCreated }: { onCreated: (complaint: ComplaintRow) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<FieldCustomerOption | null>(null);
  const [jobReference, setJobReference] = useState("");
  const [warrantyStatus, setWarrantyStatus] = useState<"In_Warranty" | "Out_Of_Warranty">("Out_Of_Warranty");
  const [issueDescription, setIssueDescription] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [attendantName, setAttendantName] = useState("");
  const [attendantPhone, setAttendantPhone] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCustomer(null);
    setJobReference("");
    setWarrantyStatus("Out_Of_Warranty");
    setIssueDescription("");
    setSiteAddress("");
    setAttendantName("");
    setAttendantPhone("");
    setAttachmentUrl("");
    setMediaUrl("");
  }

  async function handleSubmit() {
    if (!customer) {
      toast.error(t("Customer chunna zaroori hai."));
      return;
    }
    if (!issueDescription.trim()) {
      toast.error(t("Issue description likhna zaroori hai."));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          jobReference,
          warrantyStatus,
          issueDescription,
          siteAddress,
          attendantName,
          attendantPhone,
          attachmentUrl,
          mediaUrls: mediaUrl ? [mediaUrl] : [],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.complaint) {
        toast.error(t(data?.error ?? "Complaint nahi bani."));
        return;
      }
      toast.success(t("Complaint register ho gayi."));
      onCreated(data.complaint);
      setOpen(false);
      reset();
    } catch {
      toast.error(t("Complaint nahi bani."));
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
            {t("Nayi Complaint")}
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Nayi Complaint")}</DialogTitle>
          <DialogDescription>{t("Customer Master se customer chunein aur complaint details bharein.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Customer")}</Label>
            <CustomerSelect selectedId={customer?.id ?? ""} onSelect={setCustomer} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("Job / Order Reference (optional)")}</Label>
              <Input value={jobReference} onChange={(e) => setJobReference(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Warranty Status")}</Label>
              <Select value={warrantyStatus} onValueChange={(v) => setWarrantyStatus(v as typeof warrantyStatus)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="In_Warranty">{t("In Warranty")}</SelectItem>
                  <SelectItem value="Out_Of_Warranty">{t("Out of Warranty")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("Issue Description")}</Label>
            <Textarea value={issueDescription} onChange={(e) => setIssueDescription(e.target.value)} />
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
          <FileUploadField label={t("Invoice/Bill (optional)")} value={attachmentUrl} onChange={setAttachmentUrl} />
          <FileUploadField label={t("Problem Photo/Video (optional)")} value={mediaUrl} onChange={setMediaUrl} />
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
