import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import EmptyState from "@/components/empty-state";
import { reportsFor } from "@/lib/reports";
import { getT } from "@/lib/i18n/server";
import { BarChart3 } from "lucide-react";

/**
 * `/reports` itself — the content pane before any specific report is chosen from the
 * sidebar `reports/layout.tsx` renders alongside this. Picking one navigates to
 * `/reports/[report]`, which reuses this same layout and only replaces this placeholder.
 */
export default async function ReportsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const t = await getT();
  const reports = reportsFor(session.access);

  if (reports.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 />}
        title={t("Abhi koi report nahi hai")}
        description={t("Aapke Admin ne jo modules diye honge, unki reports yahan aayengi.")}
      />
    );
  }

  return (
    <EmptyState
      icon={<BarChart3 />}
      title={t("Ek report chunein")}
      description={t("Bayi taraf list se koi report chunein — wahi yahan dikhegi.")}
    />
  );
}
