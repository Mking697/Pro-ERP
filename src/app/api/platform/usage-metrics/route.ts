import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { db } from "@/db/client";
import { tenantUsageMetrics } from "@/db/schema";
import { listOrganizations } from "@/lib/platform/registry";
import { todayIST } from "@/lib/dateUtil";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const [rows, orgs] = await Promise.all([
    db
      .select()
      .from(tenantUsageMetrics)
      .where(eq(tenantUsageMetrics.metricDate, todayIST()))
      .orderBy(desc(tenantUsageMetrics.storageBytesEstimate)),
    listOrganizations(),
  ]);
  const orgNameById = new Map(orgs.map((o) => [o.id, o.orgName]));

  return NextResponse.json({
    metrics: rows.map((row) => ({
      orgId: row.orgId,
      orgName: orgNameById.get(row.orgId) ?? "",
      metricDate: row.metricDate,
      requestCount: row.requestCount,
      storageRowCount: row.storageRowCount,
      storageBytesEstimate: Number(row.storageBytesEstimate),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}
