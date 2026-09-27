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
import { formatDueDisplay } from "@/lib/formatDate";
import { TableSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface ChatAuditRow {
  id: string;
  orgId: string;
  orgName: string;
  userId: string;
  question: string;
  toolsCalled: string[];
  groundedInTool: boolean;
  errorMessage: string;
  createdAt: string;
}

/** Read-only, Platform Admin only — one row per chatbot question asked across every
 * organization, which tools it actually called, and whether the app-layer "must be
 * tool-grounded" backstop had to fire (groundedInTool: false) — see
 * src/lib/chatbot/orchestrator.ts for what that means. */
export default function ChatbotAuditTable() {
  const t = useT();
  const [logs, setLogs] = useState<ChatAuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/platform/chatbot-audit")
      .then((res) => res.json())
      .then((data: { logs?: ChatAuditRow[] }) => setLogs(data.logs ?? []))
      .catch(() => toast.error(t("Chatbot audit log load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <TableSkeleton columns={5} rows={5} />;

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("Abhi tak koi chatbot query nahi hui hai.")}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("Waqt")}</TableHead>
          <TableHead>{t("Organization")}</TableHead>
          <TableHead>{t("Sawal")}</TableHead>
          <TableHead>{t("Tools")}</TableHead>
          <TableHead>{t("Status")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDueDisplay(log.createdAt)}
            </TableCell>
            <TableCell className="max-w-40 truncate text-sm">
              {log.orgName || <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="max-w-72 truncate text-sm">{log.question}</TableCell>
            <TableCell className="max-w-52">
              {log.toolsCalled.length === 0 ? (
                <span className="text-xs text-muted-foreground">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {log.toolsCalled.map((tool) => (
                    <Badge key={tool} variant="outline" className="text-[10px]">
                      {tool}
                    </Badge>
                  ))}
                </div>
              )}
            </TableCell>
            <TableCell>
              {log.errorMessage ? (
                <Badge variant="destructive">{t("Error")}</Badge>
              ) : log.groundedInTool ? (
                <Badge variant="default">{t("Answered")}</Badge>
              ) : (
                <Badge variant="secondary">{t("Declined / Not found")}</Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
