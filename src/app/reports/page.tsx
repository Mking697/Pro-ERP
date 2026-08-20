import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import EmptyState from "@/components/empty-state";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { reportsFor } from "@/lib/reports";
import { getT } from "@/lib/i18n/server";
import { BarChart3 } from "lucide-react";

/**
 * The index of reports.
 *
 * One card per report the reader is allowed, each opening its own page. Reports used to
 * be a single tab holding eleven stacked sections, which meant scrolling past ten of them
 * to reach the eleventh — and made a share link an all-or-nothing thing.
 */
export default async function ReportsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const t = await getT();
  const reports = reportsFor(session.access);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Reports")}
          description={t(
            "Har module ki apni report. Jo aapke access me hai, wahi yahan dikhta hai — aur har report alag se share ki ja sakti hai."
          )}
        />

        {reports.length === 0 ? (
          <EmptyState
            icon={<BarChart3 />}
            title={t("Abhi koi report nahi hai")}
            description={t(
              "Aapke Admin ne jo modules diye honge, unki reports yahan aayengi."
            )}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reports.map((report) => (
              <Card
                key={report.id}
                className="transition-colors duration-150 hover:border-foreground/20"
              >
                <CardHeader>
                  <CardTitle className="text-base">
                    <Link
                      href={`/reports/${report.id}`}
                      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t(report.label)}
                    </Link>
                  </CardTitle>
                  <CardDescription>{t(report.description)}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
