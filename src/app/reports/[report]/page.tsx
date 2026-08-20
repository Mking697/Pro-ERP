import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { canSeeReport, getReport } from "@/lib/reports";
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
            {!definition.personal && (
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
        />

        <Analytics
          session={session}
          rangeKey={rangeKey}
          from={one("from")}
          to={one("to")}
          only={definition.id}
          hideFilter
        />
      </div>
    </AppShell>
  );
}
