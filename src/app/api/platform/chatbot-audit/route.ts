import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/guard";
import { listAllChatAudit } from "@/lib/chatbot/audit";
import { listOrganizations } from "@/lib/platform/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const [logs, orgs] = await Promise.all([listAllChatAudit(200), listOrganizations()]);
  const orgNameById = new Map(orgs.map((o) => [o.id, o.orgName]));

  return NextResponse.json({
    logs: logs.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      orgName: orgNameById.get(row.orgId) ?? "",
      userId: row.userId,
      question: row.question,
      toolsCalled: row.toolsCalled,
      groundedInTool: row.groundedInTool,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
