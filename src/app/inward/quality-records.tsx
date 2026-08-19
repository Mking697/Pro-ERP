"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDueDisplay } from "@/lib/formatDate";
import AttachmentLink from "@/components/attachment-link";

interface FailureRow {
  Log_ID: string;
  Linked_Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  Invoice_No: string;
  Inward_Type: string;
  Fail_Qty: string;
  Fail_Reason: string;
  Attachment_URL: string;
}

interface ImsRow {
  Record_ID: string;
  Linked_Entry_ID: string;
  Timestamp: string;
  Party_Name: string;
  Invoice_No: string;
  Inward_Type: string;
  Pass_Qty: string;
}

/**
 * Reads back the two sheets a quality check writes into.
 *
 * Rejections and accepted stock have always been recorded correctly; there was simply
 * no screen for them, so the only way to see what IQC had produced was to open the
 * Google Sheet.
 */
export default function QualityRecords({ view }: { view: "failures" | "ims" }) {
  const [failures, setFailures] = useState<FailureRow[]>([]);
  const [ims, setIms] = useState<ImsRow[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inward/records")
      .then((res) => res.json())
      .then((data: { failures?: FailureRow[]; ims?: ImsRow[]; setupRequired?: string[] }) => {
        setFailures(data.failures ?? []);
        setIms(data.ims ?? []);
        setMissing(data.setupRequired ?? []);
      })
      .catch(() => toast.error("Records load nahi ho paye."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>;
  }

  const sheetName = view === "failures" ? "Failure Log" : "IMS - Inward Sub-Sheet";
  if (missing.includes(sheetName)) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        &quot;{sheetName}&quot; sheet abhi connect nahi hui hai.
      </p>
    );
  }

  if (view === "failures") {
    return (
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Fail Qty</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Attachment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {failures.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Abhi tak koi rejection record nahi hua.
                </TableCell>
              </TableRow>
            )}
            {failures.map((row) => (
              <TableRow key={row.Log_ID}>
                <TableCell className="font-medium">{row.Party_Name}</TableCell>
                <TableCell>{row.Invoice_No}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{row.Inward_Type}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium text-destructive">
                  {row.Fail_Qty}
                </TableCell>
                <TableCell className="max-w-xs">{row.Fail_Reason}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDueDisplay(row.Timestamp)}
                </TableCell>
                <TableCell>
                  {row.Attachment_URL ? <AttachmentLink url={row.Attachment_URL} /> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Party</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Pass Qty</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ims.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                Abhi tak koi verified stock record nahi hua.
              </TableCell>
            </TableRow>
          )}
          {ims.map((row) => (
            <TableRow key={row.Record_ID}>
              <TableCell className="font-medium">{row.Party_Name}</TableCell>
              <TableCell>{row.Invoice_No}</TableCell>
              <TableCell>
                <Badge variant="secondary">{row.Inward_Type}</Badge>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                {row.Pass_Qty}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDueDisplay(row.Timestamp)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
