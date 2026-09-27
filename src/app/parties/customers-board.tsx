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
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import CreateCustomerDialog from "./create-customer-dialog";
import EditCustomerDialog from "./edit-customer-dialog";
import PartyImportDialog from "./party-import-dialog";
import type { CustomerRow } from "./types";

export default function CustomersBoard() {
  const t = useT();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  useEffect(() => {
    fetch("/api/parties/customers")
      .then((res) => res.json())
      .then((data: { customers?: CustomerRow[] }) => {
        setCustomers(data.customers ?? []);
      })
      .catch(() => toast.error(t("Customers load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  function handleCreated(customer: CustomerRow) {
    setCustomers((prev) => [...prev, customer]);
  }

  function handleUpdated(customer: CustomerRow) {
    setCustomers((prev) => prev.map((c) => (c.Customer_ID === customer.Customer_ID ? customer : c)));
  }

  if (loading) {
    return <TableSkeleton columns={6} label={t("Customers load ho rahe hain")} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PartyImportDialog
          entityLabel={t("Customer")}
          templateUrl="/api/parties/customers/import-template"
          importUrl="/api/parties/customers/import"
          onImported={() => setVersion((v) => v + 1)}
        />
        <CreateCustomerDialog onCreated={handleCreated} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Customer Name")}</TableHead>
              <TableHead>{t("Contact Person")}</TableHead>
              <TableHead>{t("Phone")}</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>{t("City")}</TableHead>
              <TableHead>{t("State")}</TableHead>
              <TableHead>{t("Credit Terms")}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {t("Abhi koi customer nahi hai.")}
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => (
              <TableRow key={c.Customer_ID}>
                <TableCell className="font-medium">{c.Customer_Name}</TableCell>
                <TableCell>{c.Contact_Person || "—"}</TableCell>
                <TableCell>{c.Phone || "—"}</TableCell>
                <TableCell>{c.Email || "—"}</TableCell>
                <TableCell>{c.City || "—"}</TableCell>
                <TableCell>{c.State || "—"}</TableCell>
                <TableCell>{c.Credit_Terms || "—"}</TableCell>
                <TableCell>
                  <Badge variant={c.Status === "Active" ? "default" : "secondary"}>
                    {c.Status || "Active"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${c.Customer_Name} edit karein`}
                    onClick={() => setEditing(c)}
                  >
                    <Pencil />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <EditCustomerDialog
        key={editing?.Customer_ID ?? "closed"}
        customer={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onUpdated={handleUpdated}
      />
    </div>
  );
}
