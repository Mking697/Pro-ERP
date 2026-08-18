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
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUploadField from "@/components/file-upload-field";
import type { InwardRecord } from "./types";

const INWARD_TYPES = ["Raw Material", "Consumable", "Other"];

export default function CreateInwardDialog({
  onCreated,
}: {
  onCreated: (entry: InwardRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [partyName, setPartyName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [inwardType, setInwardType] = useState("Raw Material");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [remark, setRemark] = useState("");

  function resetForm() {
    setPartyName("");
    setInvoiceNo("");
    setInwardType("Raw Material");
    setAttachmentUrl("");
    setRemark("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/inward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyName, invoiceNo, inwardType, attachmentUrl, remark }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Entry create nahi ho payi.");
        return;
      }

      toast.success("Inward entry submit ho gayi.");
      onCreated(data.entry);
      resetForm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>New Inward Entry</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Naya Inward Entry</DialogTitle>
          <DialogDescription>Material aane par yeh form bharein.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="partyName">Party Name</Label>
            <Input
              id="partyName"
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invoiceNo">Invoice No.</Label>
            <Input
              id="invoiceNo"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inwardType">Inward Type</Label>
            <Select value={inwardType} onValueChange={(v) => v && setInwardType(v)}>
              <SelectTrigger id="inwardType" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INWARD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FileUploadField
            label="Attachment (optional)"
            value={attachmentUrl}
            onChange={setAttachmentUrl}
          />
          <div className="space-y-2">
            <Label htmlFor="remark">Remark (optional)</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
