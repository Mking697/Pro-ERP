import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  canSeeEveryone,
  canSeeReport,
  getReport,
  resolveReportScope,
} from "@/lib/reports";
import { RANGE_PRESETS, resolveRange } from "@/lib/analytics";
import DateRangeFilter from "@/app/dashboard/date-range-filter";
import Analytics from "@/app/dashboard/analytics";
import ShareReport from "@/app/dashboard/share-report";
import { getT } from "@/lib/i18n/server";

/** One report on its own page, with its own date filter and its own share link. */
export default async function ReportPage({
  params,
  searchParams,
}: PageProps<"/reports/[report]">) {
  const { report: reportId } = await params;
  const sp = await searchParams;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) redirect("/login");

  const definition = getReport(reportId);
  if (!definition) notFound();

  // A report the reader has no grant for is not found rather than forbidden — the same
  // answer an unknown id gets, so the list of reports an organization runs is not
  // readable by trying URLs.
  if (!canSeeReport(definition, session.access)) notFound();

  const t = await getT();
  const one = (key: string) => {
    const v = sp[key];
    return typeof v === "string" ? v : undefined;
  };
  const rangeKey = one("range") ?? "month";
  const range = resolveRange(rangeKey, one("from"), one("to"));

  // Everybody sees their own work by default. Someone trusted with the whole team's MIS
  // score — an Admin, or the holder of PERFORMANCE_VIEW — can ask for the organization's,
  // and resolveReportScope quietly narrows the request for anyone else rather than
  // refusing it, because these URLs get passed around.
  const scope = resolveReportScope(one("scope"), session);
  const seesEveryone = canSeeEveryone(session);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1"
            render={
              <Link href="/reports">
                <ArrowLeft />
                {t("Saari reports")}
              </Link>
            }
          />
          <PageHeader title={t(definition.label)} description={t(definition.description)}>
            {/* Personal reports carry no share button: a public link has no reader to
                be personal to, so it would be empty or, worse, somebody else's. */}
            {/* A public link carries the whole organization's rows, not the creator's
                own slice — a supplier sent an inward report wants the shipments, not one
                clerk's share of them. That makes creating a link a way of publishing
                everybody's work, so it is offered only to someone already entitled to see
                everybody's work. The API enforces the same rule. */}
            {!definition.personal && seesEveryone && (
              <ShareReport
                reportId={definition.id}
                reportLabel={t(definition.label)}
                rangeKey={rangeKey}
              />
            )}
          </PageHeader>
        </div>

        <DateRangeFilter
          active={range}
          presets={RANGE_PRESETS}
          from={one("from")}
          to={one("to")}
          // A personal report is already only ever about the reader — offering to widen
          // it would promise something the report cannot do.
          scope={definition.personal ? undefined : scope}
          canSeeEveryone={seesEveryone}
        />

        <Analytics
          session={session}
          rangeKey={rangeKey}
          from={one("from")}
          to={one("to")}
          only={definition.id}
          hideFilter
          scope={scope}
        />
      </div>
    </AppShell>
  );
}
