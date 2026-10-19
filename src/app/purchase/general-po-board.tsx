"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import FileUploadField from "@/components/file-upload-field";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { FileText, Trash2 } from "lucide-react";
import { useT } from "@/components/preferences-provider";

interface VendorOption {
  id: string;
  name: string;
  phone: string;
  city: string;
}

interface PlanMaterialOption {
  sku: string;
  itemName: string;
  uom: string;
  requiredQty: number;
}

interface PlanOption {
  id: string;
  jobNo: string;
  productName: string;
  status: string;
  materials: PlanMaterialOption[];
}

interface LineDraft {
  particular: string;
  description: string;
  uom: string;
  qty: string;
  rate: string;
}

interface GeneralPoLine {
  id: string;
  particular: string;
  description: string;
  uom: string;
  qty: number;
  rate: number;
  amount: number;
  receivedQty: number | null;
}

interface GeneralPo {
  id: string;
  vendorId: string;
  vendorName: string;
  planId: string;
  planJobNo: string;
  planProductName: string;
  status: string;
  attachmentUrl: string;
  invoiceUrl: string;
  issuedAt: string;
  expectedDeliveryDays: number;
  followUpDueAt: string;
  followUpDoneAt: string;
  followUpRemark: string;
  receivedAt: string;
  gstPercent: number;
  termsAndConditions: string;
  note: string;
  lines: GeneralPoLine[];
  subTotal: number;
  gstAmount: number;
  grandTotal: number;
}

const EMPTY_LINE: LineDraft = { particular: "", description: "", uom: "", qty: "", rate: "" };

function statusVariant(status: string): "success" | "secondary" | "destructive" | "outline" {
  if (status === "Completed") return "success";
  if (status === "Cancelled") return "destructive";
  return "secondary";
}

export default function GeneralPoBoard() {
  const t = useT();
  const [orders, setOrders] = useState<GeneralPo[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [planId, setPlanId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [expectedDeliveryDays, setExpectedDeliveryDays] = useState("7");
  const [gstPercent, setGstPercent] = useState("0");
  const [note, setNote] = useState("");
  const [termsAndConditions, setTermsAndConditions] = useState("");
  const [saving, setSaving] = useState(false);

  // Follow-up dialog
  const [followUpTarget, setFollowUpTarget] = useState<GeneralPo | null>(null);
  const [followUpRemark, setFollowUpRemark] = useState("");
  const [followUpSaving, setFollowUpSaving] = useState(false);

  // Receive dialog
  const [receiveTarget, setReceiveTarget] = useState<GeneralPo | null>(null);
  const [receiveQtyDraft, setReceiveQtyDraft] = useState<Record<string, string>>({});
  const [receiveInvoiceUrl, setReceiveInvoiceUrl] = useState("");
  const [receiveSaving, setReceiveSaving] = useState(false);

  function load() {
    fetch("/api/purchase/general")
      .then((res) => res.json())
      .then((data: { orders?: GeneralPo[] }) => setOrders(data.orders ?? []))
      .catch(() => toast.error(t("General PO list load nahi ho payi.")))
      .finally(() => setLoading(false));
  }

  function refetch() {
    setLoading(true);
    setVersion((v) => v + 1);
  }

  useEffect(load, [version, t]);

  useEffect(() => {
    if (!createOpen) return;
    fetch("/api/purchase/general/vendors-lookup")
      .then((res) => res.json())
      .then((data: { vendors?: VendorOption[] }) => setVendors(data.vendors ?? []))
      .catch(() => toast.error(t("Vendors load nahi ho paye.")));
    fetch("/api/purchase/general/plans-lookup")
      .then((res) => res.json())
      .then((data: { plans?: PlanOption[] }) => setPlans(data.plans ?? []))
      .catch(() => toast.error(t("Jobs (Production Plans) load nahi ho paye.")));
  }, [createOpen, t]);

  function resetCreateForm() {
    setVendorId("");
    setPlanId("");
    setLines([{ ...EMPTY_LINE }]);
    setAttachmentUrl("");
    setExpectedDeliveryDays("7");
    setGstPercent("0");
    setNote("");
    setTermsAndConditions("");
  }

  function pullPlanMaterials() {
    const plan = plans.find((p) => p.id === planId);
    if (!plan || plan.materials.length === 0) {
      toast.error(t("Is Job ki koi material list nahi mili."));
      return;
    }
    setLines(
      plan.materials.map((m) => ({
        particular: m.itemName,
        description: m.sku,
        uom: m.uom,
        qty: String(m.requiredQty),
        rate: "",
      }))
    );
  }

  const lineAmounts = useMemo(
    () => lines.map((l) => (Number(l.qty) || 0) * (Number(l.rate) || 0)),
    [lines]
  );
  const createSubTotal = lineAmounts.reduce((sum, a) => sum + a, 0);

  async function handleCreate() {
    const validLines = lines.filter((l) => l.particular.trim());
    if (validLines.length === 0) {
      toast.error(t("Kam se kam ek item chunein."));
      return;
    }
    if (!vendorId) {
      toast.error(t("Vendor chunein."));
      return;
    }
    if (!attachmentUrl) {
      toast.error(t("PO attachment zaroori hai."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/purchase/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          planId: planId || undefined,
          lines: validLines.map((l) => ({
            particular: l.particular,
            description: l.description,
            uom: l.uom,
            qty: Number(l.qty) || 0,
            rate: Number(l.rate) || 0,
          })),
          attachmentUrl,
          expectedDeliveryDays: Number(expectedDeliveryDays) || 0,
          gstPercent: Number(gstPercent) || 0,
          termsAndConditions,
          note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "PO ban nahi paya."));
        return;
      }
      toast.success(t("PO") + ` ${data.order.id} ` + t("ban gaya."));
      setCreateOpen(false);
      resetCreateForm();
      refetch();
    } finally {
      setSaving(false);
    }
  }

  async function handleFollowUp() {
    if (!followUpTarget) return;
    setFollowUpSaving(true);
    try {
      const res = await fetch(`/api/purchase/general/${followUpTarget.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remark: followUpRemark }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Follow-up save nahi ho paya."));
        return;
      }
      toast.success(t("Follow-up complete ho gaya."));
      setFollowUpTarget(null);
      setFollowUpRemark("");
      refetch();
    } finally {
      setFollowUpSaving(false);
    }
  }

  function openReceive(po: GeneralPo) {
    setReceiveTarget(po);
    setReceiveQtyDraft(
      Object.fromEntries(po.lines.map((l) => [l.id, String(l.receivedQty ?? l.qty)]))
    );
    setReceiveInvoiceUrl(po.invoiceUrl);
  }

  async function handleReceive() {
    if (!receiveTarget) return;
    setReceiveSaving(true);
    try {
      const res = await fetch(`/api/purchase/general/${receiveTarget.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: receiveTarget.lines.map((l) => ({
            lineId: l.id,
            receivedQty: Number(receiveQtyDraft[l.id]) || 0,
          })),
          invoiceUrl: receiveInvoiceUrl || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Receive save nahi ho paya."));
        return;
      }
      toast.success(t("Material Received mark ho gaya — PO complete."));
      setReceiveTarget(null);
      refetch();
    } finally {
      setReceiveSaving(false);
    }
  }

  async function handleCancel(po: GeneralPo) {
    const res = await fetch(`/api/purchase/general/${po.id}/cancel`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      toast.error(t(data?.error ?? "Cancel nahi ho paya."));
      return;
    }
    toast.success(t("PO cancel ho gaya."));
    refetch();
  }

  if (loading) {
    return <TableSkeleton columns={6} label={t("General POs load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) resetCreateForm(); }}>
          <DialogTrigger render={<Button>{t("+ Nayi General PO")}</Button>} />
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t("Nayi General / Independent PO")}</DialogTitle>
              <DialogDescription>
                {t(
                  "Raw material ke alawa kuch bhi kisi bhi Vendor se order karein — asset, service, ya koi bhi one-off item. Chahen to ek Job (Production Plan) se link karein."
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gpo-vendor">{t("Vendor")}</Label>
                <Select value={vendorId || undefined} onValueChange={(v) => v && setVendorId(v)}>
                  <SelectTrigger id="gpo-vendor" className="w-full">
                    <SelectValue placeholder={t("Vendor chunein")} />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="gpo-plan">{t("Job / Production Plan (optional)")}</Label>
                <Select value={planId || undefined} onValueChange={(v) => setPlanId(v ?? "")}>
                  <SelectTrigger id="gpo-plan" className="w-full">
                    <SelectValue placeholder={t("Koi Job nahi (general purchase)")} />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {(p.jobNo || p.id) + " — " + p.productName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {planId && (
              <Button type="button" variant="outline" size="sm" onClick={pullPlanMaterials}>
                {t("Job ki material list se items bharein")}
              </Button>
            )}

            <div className="space-y-2">
              <Label>{t("Items")}</Label>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Particular")}</TableHead>
                      <TableHead>{t("Description")}</TableHead>
                      <TableHead>{t("UOM")}</TableHead>
                      <TableHead className="text-right">{t("Qty")}</TableHead>
                      <TableHead className="text-right">{t("Rate")}</TableHead>
                      <TableHead className="text-right">{t("Amount")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Input
                            value={line.particular}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, particular: e.target.value } : l))
                              )
                            }
                            aria-label={t("Particular")}
                            className="h-8 min-w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.description}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, description: e.target.value } : l))
                              )
                            }
                            aria-label={t("Description")}
                            className="h-8 min-w-32"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.uom}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, uom: e.target.value } : l))
                              )
                            }
                            aria-label={t("UOM")}
                            className="h-8 w-20"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            value={line.qty}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, qty: e.target.value } : l))
                              )
                            }
                            aria-label={t("Qty")}
                            className="h-8 w-24 text-right tabular-nums"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            value={line.rate}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((l, i) => (i === idx ? { ...l, rate: e.target.value } : l))
                              )
                            }
                            aria-label={t("Rate")}
                            className="h-8 w-24 text-right tabular-nums"
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {lineAmounts[idx].toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Line hatayein")}
                            onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                          >
                            <Trash2 />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
                >
                  {t("+ Line")}
                </Button>
                <span className="text-sm font-medium">
                  {t("Sub Total")}: {createSubTotal.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="gpo-delivery-days">{t("Expected Delivery (din)")}</Label>
                <Input
                  id="gpo-delivery-days"
                  type="number"
                  min="0"
                  value={expectedDeliveryDays}
                  onChange={(e) => setExpectedDeliveryDays(e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gpo-gst">{t("GST %")}</Label>
                <Input
                  id="gpo-gst"
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  value={gstPercent}
                  onChange={(e) => setGstPercent(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gpo-note">{t("Note")}</Label>
              <Textarea id="gpo-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gpo-terms">{t("Terms & Conditions")}</Label>
              <Textarea
                id="gpo-terms"
                rows={3}
                value={termsAndConditions}
                onChange={(e) => setTermsAndConditions(e.target.value)}
              />
            </div>

            <FileUploadField
              label={t("PO Attachment")}
              value={attachmentUrl}
              onChange={setAttachmentUrl}
            />

            <DialogFooter>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? t("Issuing...") : t("PO Issue karein")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={t("Abhi koi General PO nahi hai")}
          description={t("Raw material ke alawa kisi bhi cheez ke liye yahan se PO banayein.")}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("PO")}</TableHead>
                <TableHead>{t("Vendor")}</TableHead>
                <TableHead>{t("Job")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead className="text-right">{t("Grand Total")}</TableHead>
                <TableHead className="text-right">{t("Action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((po) => (
                <TableRow key={po.id}>
                  <TableCell className="font-medium">{po.id}</TableCell>
                  <TableCell>{po.vendorName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {po.planJobNo || po.planId ? po.planJobNo || po.planId : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(po.status)}>{po.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{po.grandTotal.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {po.status === "Open" && !po.followUpDoneAt && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFollowUpTarget(po);
                            setFollowUpRemark("");
                          }}
                        >
                          {t("Follow Up")}
                        </Button>
                      )}
                      {po.status === "Open" && po.followUpDoneAt && (
                        <Button size="sm" variant="outline" onClick={() => openReceive(po)}>
                          {t("Material Received")}
                        </Button>
                      )}
                      {po.status === "Open" && !po.followUpDoneAt && (
                        <Button size="sm" variant="ghost" onClick={() => handleCancel(po)}>
                          {t("Cancel")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Follow-up dialog */}
      <Dialog open={!!followUpTarget} onOpenChange={(v) => !v && setFollowUpTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Follow Up Complete Karein")}</DialogTitle>
            <DialogDescription>{followUpTarget?.id}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="gpo-followup-remark">{t("Remark")}</Label>
            <Textarea
              id="gpo-followup-remark"
              rows={3}
              value={followUpRemark}
              onChange={(e) => setFollowUpRemark(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={handleFollowUp} disabled={followUpSaving}>
              {followUpSaving ? t("Saving...") : t("Follow Up Complete Karein")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive dialog */}
      <Dialog open={!!receiveTarget} onOpenChange={(v) => !v && setReceiveTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Material Received")}</DialogTitle>
            <DialogDescription>{receiveTarget?.id}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {receiveTarget?.lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {line.particular}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({t("Ordered")} {line.qty} {line.uom})
                  </span>
                </span>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={receiveQtyDraft[line.id] ?? ""}
                  onChange={(e) =>
                    setReceiveQtyDraft((d) => ({ ...d, [line.id]: e.target.value }))
                  }
                  aria-label={`${line.particular} — ${t("Received Qty")}`}
                  className="h-8 w-28 text-right tabular-nums"
                />
              </div>
            ))}
          </div>
          <FileUploadField
            label={t("Invoice")}
            value={receiveInvoiceUrl}
            onChange={setReceiveInvoiceUrl}
          />
          <DialogFooter>
            <Button onClick={handleReceive} disabled={receiveSaving}>
              {receiveSaving ? t("Saving...") : t("Material Received Mark Karein")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
