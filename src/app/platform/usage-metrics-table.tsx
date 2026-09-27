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
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface UsageMetricRow {
  orgId: string;
  orgName: string;
  metricDate: string;
  requestCount: number;
  storageRowCount: number;
  storageBytesEstimate: number;
  updatedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

/**
 * Read-only — today's storage-share and request-share numbers per org, computed by the
 * daily cron (`computeTenantUsageMetrics()`/`recordTenantRequest()` in
 * `src/lib/platform/usageMetrics.ts`). An approximation, not a real per-tenant bill — Neon
 * itself has no concept of "tenant" to bill against.
 */
export default function UsageMetricsTable() {
  const t = useT();
  const [rows, setRows] = useState<UsageMetricRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/platform/usage-metrics")
      .then((res) => res.json())
      .then((data: { metrics?: UsageMetricRow[] }) => setRows(data.metrics ?? []))
      .catch(() => toast.error(t("Usage metrics load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <TableSkeleton columns={4} rows={5} />;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Aaj ke liye abhi tak koi usage data nahi hai — daily cron chalne ke baad yahan dikhega.")}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Organization")}</TableHead>
          <TableHead>{t("Requests (aaj)")}</TableHead>
          <TableHead>{t("Rows")}</TableHead>
          <TableHead>{t("Storage (approx.)")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.orgId}>
            <TableCell className="max-w-48 truncate text-sm">
              {row.orgName || <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="tabular-nums">{row.requestCount.toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{row.storageRowCount.toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{formatBytes(row.storageBytesEstimate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
