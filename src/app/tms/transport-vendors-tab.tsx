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
import PartyImportDialog from "@/app/parties/party-import-dialog";
import CreateTransportVendorDialog from "./create-transport-vendor-dialog";
import type { TransportVendorRow } from "./types";

export default function TransportVendorsTab() {
  const t = useT();
  const [vendors, setVendors] = useState<TransportVendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/tms/vendors")
      .then((res) => res.json())
      .then((data: { vendors?: TransportVendorRow[] }) => setVendors(data.vendors ?? []))
      .catch(() => toast.error(t("Transport Vendors load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  if (loading) {
    return <TableSkeleton columns={6} label={t("Transport Vendors load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PartyImportDialog
          entityLabel={t("Transport Vendor")}
          templateUrl="/api/tms/vendors/import-template"
          importUrl="/api/tms/vendors/import"
          onImported={() => setVersion((v) => v + 1)}
        />
        <CreateTransportVendorDialog onCreated={() => setVersion((v) => v + 1)} />
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
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {t("Abhi koi Transport Vendor nahi hai.")}
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
                <TableCell>
                  <Badge variant={v.Status === "Active" ? "default" : "secondary"}>
                    {v.Status || "Active"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
