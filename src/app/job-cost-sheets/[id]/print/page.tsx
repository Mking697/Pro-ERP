import React from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { tenantFromOrgId, runWithTenant } from "@/lib/tenant";
import { getJobCostSheet } from "@/lib/job-costing/service";
import Snapshot from "../../snapshot";
import PrintActions from "./print-actions";

export default async function JobCostSheetPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const session = await getLiveSession();
  if (!session) redirect("/login");
  if (!session.access.includes("JOB_COST_SHEETS")) redirect("/dashboard");
  const tenant = await tenantFromOrgId(session.orgId);
  return runWithTenant(tenant, async () => {
    const { id } = await params;
    const sheet = await getJobCostSheet(id);
    if (!sheet) notFound();
    return <main className="mx-auto max-w-6xl space-y-6 p-6 print:max-w-none print:p-0">
      <PrintActions />
      <Snapshot calculation={sheet.calculation} sheet={sheet} />
    </main>;
  });
}
