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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDueDisplay } from "@/lib/formatDate";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface ErrorLogRow {
  id: string;
  orgId: string;
  orgName: string;
  routePath: string;
  routeType: string;
  message: string;
  digest: string;
  stack: string;
  createdAt: string;
}

/**
 * Read-only — this is a diagnostics view, not an action surface. Every row here came from
 * `src/instrumentation.ts`'s global `onRequestError` hook, or from one of the explicit
 * `logError()` call sites (a cron job's per-organization failure, a WhatsApp send that
 * failed) that would otherwise stay silent.
 */
export default function ErrorLogsTable() {
  const t = useT();
  const [logs, setLogs] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<ErrorLogRow | null>(null);

  useEffect(() => {
    fetch("/api/platform/error-logs")
      .then((res) => res.json())
      .then((data: { logs?: ErrorLogRow[] }) => setLogs(data.logs ?? []))
      .catch(() => toast.error(t("Error logs load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <TableSkeleton columns={4} rows={5} />;

  if (logs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("Abhi tak koi server error record nahi hua hai.")}
      </p>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Waqt")}</TableHead>
            <TableHead>{t("Organization")}</TableHead>
            <TableHead>{t("Route")}</TableHead>
            <TableHead>{t("Message")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow
              key={log.id}
              className="cursor-pointer"
              onClick={() => setExpanded(log)}
            >
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {formatDueDisplay(log.createdAt)}
              </TableCell>
              <TableCell className="max-w-40 truncate text-sm">
                {log.orgName || <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="max-w-52 truncate text-sm">
                {log.routePath ? (
                  <>
                    <span className="font-mono text-xs">{log.routePath}</span>
                    {log.routeType && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {log.routeType}
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="max-w-96 truncate text-sm">{log.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!expanded} onOpenChange={(open) => !open && setExpanded(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="break-all">{expanded?.message}</DialogTitle>
          </DialogHeader>
          {expanded && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {formatDueDisplay(expanded.createdAt)}
                {expanded.orgName ? ` · ${expanded.orgName}` : ""}
                {expanded.routePath ? ` · ${expanded.routePath}` : ""}
              </p>
              {expanded.stack && (
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {expanded.stack}
                </pre>
              )}
              <Button variant="outline" size="sm" onClick={() => setExpanded(null)}>
                {t("Band karein")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
