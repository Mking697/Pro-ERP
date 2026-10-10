import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getT } from "@/lib/i18n/server";
import { listLeads } from "@/lib/leads/leads";
import LeadsBoard from "./leads-board";
import QuotationsBoard from "./quotations-board";

export default async function LeadsPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("LEAD_FMS")) redirect("/dashboard");

  // Fetched here (server-rendered, same request the page itself needs) rather than left
  // for LeadsBoard's own client-side effect to fetch after hydration — removes the
  // always-shows-once loading skeleton a client-only fetch used to produce on first paint.
  const initialLeads = await listLeads();

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title="Leads"
          description={t(
            "Lead punch/import se le kar Qualify, Follow-up, Meeting, Negotiation aur Quotation tak — poora sales pipeline."
          )}
        />
        <Tabs defaultValue="pipeline">
          <TabsList>
            <TabsTrigger value="pipeline">{t("Pipeline")}</TabsTrigger>
            <TabsTrigger value="quotations">Quotations</TabsTrigger>
          </TabsList>
          <TabsContent value="pipeline" className="mt-4">
            <LeadsBoard initialLeads={initialLeads} />
          </TabsContent>
          <TabsContent value="quotations" className="mt-4">
            <QuotationsBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
