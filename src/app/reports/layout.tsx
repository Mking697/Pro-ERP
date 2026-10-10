import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { reportsFor } from "@/lib/reports";
import { getT } from "@/lib/i18n/server";
import ReportsNav from "./reports-nav";

/**
 * Every report used to live on its own page, reached from a grid of cards on `/reports` —
 * opening one meant leaving the list behind, and finding a different report meant a trip
 * back. This layout keeps the list of reports on screen the whole time (a sidebar on wide
 * screens, scrollable pills on a phone) and only swaps the content pane per report, via the
 * ordinary `/reports/[report]` route each report already has — so a direct link or a share
 * link still opens exactly one report, this only changes what surrounds it.
 */
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const session = await getLiveSession();

  if (!session) redirect("/login");

  const t = await getT();
  const reports = reportsFor(session.access).map((report) => ({
    id: report.id,
    label: t(report.label),
  }));

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Reports")}
          description={t(
            "Har module ki apni report. Jo aapke access me hai, wahi yahan dikhta hai — aur har report alag se share ki ja sakti hai."
          )}
        />
        {reports.length > 0 && (
          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <ReportsNav reports={reports} />
            <div className="min-w-0">{children}</div>
          </div>
        )}
        {reports.length === 0 && children}
      </div>
    </AppShell>
  );
}
