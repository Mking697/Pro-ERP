import React from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getLiveSession } from "@/lib/auth/live-session";
import { tenantFromOrgId, runWithTenant } from "@/lib/tenant";
import { todayIST } from "@/lib/dateUtil";
import { getT } from "@/lib/i18n/server";
import JobCostSheetsBoard from "./board";

export default async function JobCostSheetsPage({ searchParams }: { searchParams: Promise<{ planId?: string | string[] }> }) {
  await connection();
  const session = await getLiveSession();
  if (!session) redirect("/login");
  if (!session.access.includes("JOB_COST_SHEETS")) redirect("/dashboard");
  const tenant = await tenantFromOrgId(session.orgId);
  return runWithTenant(tenant, async () => {
    const t = await getT();
    const query = await searchParams;
    const initialPlanId = typeof query.planId === "string" ? query.planId : "";
    return <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader title={t("Job Cost Sheets")} description={t("Recorded job cost sheet — provisional management valuation from recorded issues/output/general expenses. Actual proven historical cost ya GL posting nahi hai.")} />
        <JobCostSheetsBoard key={`${session.orgId}:${session.userId}:${[...session.access].sort().join(",")}`} initialPlanId={initialPlanId} initialDate={todayIST()} />
      </div>
    </AppShell>;
  });
}
