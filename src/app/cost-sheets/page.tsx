import React from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getLiveSession } from "@/lib/auth/live-session";
import { tenantFromOrgId, runWithTenant } from "@/lib/tenant";
import { todayIST } from "@/lib/dateUtil";
import { getT } from "@/lib/i18n/server";
import CostSheetsBoard from "./cost-sheets-board";

export default async function CostSheetsPage({ searchParams }: { searchParams: Promise<{ productSku?: string | string[] }> }) {
  await connection();
  const session = await getLiveSession();
  if (!session) redirect("/login");
  if (!session.access.includes("COST_SHEETS")) redirect("/dashboard");
  const tenant = await tenantFromOrgId(session.orgId);
  return runWithTenant(tenant, async () => {
    const t = await getT();
    const query = await searchParams;
    const initialProductSku = typeof query.productSku === "string" ? query.productSku : "";
    return <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader title={t("Cost Sheets")} description={t("Estimated product cost; actual job cost nahi. Saved snapshots ko hi print aur export kiya jaata hai.")} />
        <CostSheetsBoard key={`${session.orgId}:${session.userId}:${[...session.access].sort().join(",")}`} initialProductSku={initialProductSku} initialDate={todayIST()} />
      </div>
    </AppShell>;
  });
}
