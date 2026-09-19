"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { FileText } from "lucide-react";
import { useT } from "@/components/preferences-provider";

interface VendorOption {
  vendorId: string;
  vendorName: string;
  leadTimeDays: string;
  unitPrice: string;
}

interface Candidate {
  indentId: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  reason: string;
  vendors: VendorOption[];
}

/**
 * Step 2 — PO Issue. Vendor-first: pick a vendor, and every Approved indent that vendor is
 * linked to supply gets suggested (pre-checked) with its last price — because the same
 * vendor issuing one PO for several items it already supplies is the whole point of the
 * bundling this screen exists for.
 */
export default function PoIssueBoard() {
  const t = useT();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendorId, setVendorId] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/purchase/candidates")
      .then((res) => res.json())
      .then((data: { candidates?: Candidate[] }) => setCandidates(data.candidates ?? []))
      .catch(() => toast.error(t("Candidates load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  const vendorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) {
      for (const v of c.vendors) map.set(v.vendorId, v.vendorName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [candidates]);

  const eligible = useMemo(
    () =>
      vendorId
        ? candidates
            .map((c) => ({ candidate: c, vendor: c.vendors.find((v) => v.vendorId === vendorId) }))
            .filter((r): r is { candidate: Candidate; vendor: VendorOption } => Boolean(r.vendor))
        : [],
    [candidates, vendorId]
  );

  function handleVendorChange(id: string) {
    setVendorId(id);
    const rows = candidates
      .map((c) => ({ candidate: c, vendor: c.vendors.find((v) => v.vendorId === id) }))
      .filter((r): r is { candidate: Candidate; vendor: VendorOption } => Boolean(r.vendor));

    setSelected(Object.fromEntries(rows.map((r) => [r.candidate.indentId, true])));
    setPriceDraft(Object.fromEntries(rows.map((r) => [r.candidate.indentId, r.vendor.unitPrice])));
  }

  const chosen = eligible.filter((r) => selected[r.candidate.indentId]);

  async function issuePo() {
    if (chosen.length === 0) {
      toast.error(t("Kam se kam ek item chunein."));
      return;
    }
    if (!attachmentUrl) {
      toast.error(t("PO attachment zaroori hai."));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/purchase/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          attachmentUrl,
          lines: chosen.map((r) => ({
            indentId: r.candidate.indentId,
            newPrice: priceDraft[r.candidate.indentId] || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "PO issue nahi ho paya."));
        return;
      }

      toast.success(`PO ${data.order.id} ban gaya — ${chosen.length} item(s).`);
      setVendorId("");
      setSelected({});
      setPriceDraft({});
      setAttachmentUrl("");
      setVersion((v) => v + 1);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <TableSkeleton columns={5} label={t("Candidates load ho rahe hain")} />;
  }

  if (candidates.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title={t("Abhi koi Approved indent nahi hai")}
        description={t("Indent Approve hote hi wo yahan PO ke liye aa jaayega.")}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("Vendor chunein")}</Label>
        <Select value={vendorId || undefined} onValueChange={(v) => v && handleVendorChange(v)}>
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder={t("Vendor select karein")} />
          </SelectTrigger>
          <SelectContent>
            {vendorOptions.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {vendorOptions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("Koi bhi Approved indent ka item kisi vendor se linked nahi hai — pehle Parties me Vendor ↔ Item link karein.")}
          </p>
        )}
      </div>

      {vendorId && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>{t("Item")}</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">{t("Old Price")}</TableHead>
                  <TableHead className="text-right">{t("New Price")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      {t("Ye vendor is list ke kisi item ko supply nahi karta.")}
                    </TableCell>
                  </TableRow>
                )}
                {eligible.map((r) => (
                  <TableRow key={r.candidate.indentId}>
                    <TableCell>
                      <Checkbox
                        checked={selected[r.candidate.indentId] === true}
                        aria-label={`${r.candidate.itemName} select karein`}
                        onCheckedChange={(checked) =>
                          setSelected((s) => ({ ...s, [r.candidate.indentId]: checked === true }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <span className="block font-medium">{r.candidate.itemName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.candidate.sku} · {r.candidate.reason.replace("_", " ")}
                        {r.vendor.leadTimeDays && ` · Lead ${r.vendor.leadTimeDays}d`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.candidate.qty} {r.candidate.uom}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.vendor.unitPrice || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={priceDraft[r.candidate.indentId] ?? ""}
                        onChange={(e) =>
                          setPriceDraft((d) => ({ ...d, [r.candidate.indentId]: e.target.value }))
                        }
                        className="h-8 w-28 text-right tabular-nums"
                        aria-label={`${r.candidate.itemName} — new price`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="max-w-sm">
            <FileUploadField
              label={t("PO Attachment")}
              value={attachmentUrl}
              onChange={setAttachmentUrl}
            />
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary">{chosen.length} {t("item chuna")}</Badge>
            <Button onClick={issuePo} disabled={saving || chosen.length === 0}>
              {saving ? "Issuing..." : t("PO Issue karein")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
