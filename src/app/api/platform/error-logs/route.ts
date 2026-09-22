import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { listErrorLogs } from "@/lib/errorLog";
import { listOrganizations } from "@/lib/platform/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const [logs, orgs] = await Promise.all([listErrorLogs(200), listOrganizations()]);
  const orgNameById = new Map(orgs.map((o) => [o.id, o.orgName]));

  return NextResponse.json({
    logs: logs.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      orgName: row.orgId ? (orgNameById.get(row.orgId) ?? "") : "",
      routePath: row.routePath,
      routeType: row.routeType,
      message: row.message,
      digest: row.digest,
      stack: row.stack,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
