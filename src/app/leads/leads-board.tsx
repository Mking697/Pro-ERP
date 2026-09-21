"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/loading-states";
import EmptyState from "@/components/empty-state";
import { Users } from "lucide-react";
import { useT } from "@/components/preferences-provider";
import PartyImportDialog from "@/app/parties/party-import-dialog";
import CreateLeadDialog from "./create-lead-dialog";
import LeadDetailDialog from "./lead-detail-dialog";
import { LEAD_STATUS_LABEL, type LeadRow, type LeadStatus } from "./types";

const TABS: { value: string; label: string; statuses: LeadStatus[] | null }[] = [
  { value: "open", label: "Open", statuses: ["New", "Qualified", "Follow_Up", "Meeting_Scheduled", "Negotiation", "Quotation_Sent"] },
  { value: "New", label: "New", statuses: ["New"] },
  { value: "Follow_Up", label: "Follow Up", statuses: ["Qualified", "Follow_Up"] },
  { value: "Meeting_Scheduled", label: "Meeting", statuses: ["Meeting_Scheduled"] },
  { value: "Negotiation", label: "Negotiation", statuses: ["Negotiation", "Quotation_Sent"] },
  { value: "won", label: "Won", statuses: ["Order_Confirmed"] },
  { value: "lost", label: "Lost / Junk", statuses: ["Lost", "Junk"] },
  { value: "all", label: "All", statuses: null },
];

function statusVariant(status: LeadStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "Order_Confirmed") return "default";
  if (status === "Lost" || status === "Junk") return "destructive";
  if (status === "New") return "outline";
  return "secondary";
}

export default function LeadsBoard() {
  const t = useT();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState("open");
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads")
      .then((res) => res.json())
      .then((data: { leads?: LeadRow[] }) => setLeads(data.leads ?? []))
      .catch(() => toast.error(t("Leads load nahi ho paye.")))
      .finally(() => setLoading(false));
  }, [version, t]);

  const filtered = useMemo(() => {
    const def = TABS.find((tb) => tb.value === tab);
    if (!def || !def.statuses) return leads;
    const set = new Set<LeadStatus>(def.statuses);
    return leads.filter((l) => set.has(l.status));
  }, [leads, tab]);

  function handleCreated(lead: LeadRow) {
    setLeads((prev) => [lead, ...prev]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PartyImportDialog
          entityLabel="Lead"
          templateUrl="/api/leads/import-template"
          importUrl="/api/leads/import"
          onImported={() => setVersion((v) => v + 1)}
        />
        <CreateLeadDialog onCreated={handleCreated} />
      </div>

      <Tabs value={tab} onValueChange={(v) => v && setTab(v)}>
        <TabsList className="flex-wrap">
          {TABS.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value}>
              {t(tb.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tb) => (
          <TabsContent key={tb.value} value={tb.value} className="mt-4">
            {loading ? (
              <TableSkeleton columns={6} label={t("Leads load ho rahe hain")} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title={t("Abhi koi lead nahi hai")}
                description={t("Naya lead punch karein ya bulk import se le aayein.")}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Naam")}</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>{t("Phone")}</TableHead>
                      <TableHead>{t("City")}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{t("Agla Follow-up / Meeting")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((lead, i) => (
                      <TableRow
                        key={lead.id}
                        style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                        className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both cursor-pointer"
                        onClick={() => setOpenLeadId(lead.id)}
                      >
                        <TableCell className="font-medium">{lead.personName}</TableCell>
                        <TableCell>{lead.companyName || "—"}</TableCell>
                        <TableCell>{lead.phone || "—"}</TableCell>
                        <TableCell>{lead.city || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(lead.status)}>{t(LEAD_STATUS_LABEL[lead.status])}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {(lead.nextFollowUpAt || lead.meetingAt)
                            ? new Date(lead.nextFollowUpAt || lead.meetingAt).toLocaleString("en-IN")
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {openLeadId && (
        <LeadDetailDialog
          leadId={openLeadId}
          open={Boolean(openLeadId)}
          onOpenChange={(open) => {
            if (!open) setOpenLeadId(null);
          }}
          onChanged={(lead) => {
            setLeads((prev) => prev.map((l) => (l.id === lead.id ? lead : l)));
          }}
        />
      )}
    </div>
  );
}
