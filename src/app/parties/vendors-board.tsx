"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import CreateVendorDialog from "./create-vendor-dialog";
import PartyImportDialog from "./party-import-dialog";
import VendorItemsDialog from "./vendor-items-dialog";
import type { VendorRow } from "./types";

export default function VendorsBoard() {
  const t = useT();
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/parties/vendors")
      .then((res) => res.json())
      .then((data: { vendors?: VendorRow[] }) => {
        setVendors(data.vendors ?? []);
      })
      .catch(() => toast.error(t("Vendors load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  function handleCreated(vendor: VendorRow) {
    setVendors((prev) => [...prev, vendor]);
  }

  if (loading) {
    return <TableSkeleton columns={6} label={t("Vendors load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PartyImportDialog
          entityLabel={t("Purchase Vendor")}
          templateUrl="/api/parties/vendors/import-template"
          importUrl="/api/parties/vendors/import"
          onImported={() => setVersion((v) => v + 1)}
        />
        <CreateVendorDialog onCreated={handleCreated} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Vendor Name")}</TableHead>
              <TableHead>{t("Contact Person")}</TableHead>
              <TableHead>{t("Phone")}</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>{t("City")}</TableHead>
              <TableHead>{t("State")}</TableHead>
              <TableHead>{t("Payment Terms")}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {t("Abhi koi vendor nahi hai.")}
                </TableCell>
              </TableRow>
            )}
            {vendors.map((v, i) => (
              <TableRow
                key={v.Vendor_ID}
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both"
              >
                <TableCell className="font-medium">{v.Vendor_Name}</TableCell>
                <TableCell>{v.Contact_Person || "—"}</TableCell>
                <TableCell>{v.Phone || "—"}</TableCell>
                <TableCell>{v.Email || "—"}</TableCell>
                <TableCell>{v.City || "—"}</TableCell>
                <TableCell>{v.State || "—"}</TableCell>
                <TableCell>{v.Payment_Terms || "—"}</TableCell>
                <TableCell>
                  <Badge variant={v.Status === "Active" ? "default" : "secondary"}>
                    {v.Status || "Active"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <VendorItemsDialog vendorId={v.Vendor_ID} vendorName={v.Vendor_Name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
