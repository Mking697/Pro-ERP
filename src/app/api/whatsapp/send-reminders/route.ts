import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { sendPendingTaskReminders } from "@/lib/reminders";
import { forEachActiveOrganization } from "@/lib/platform/runner";

// Walking every tenant sequentially takes longer than a single-org run ever did.
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

export async function POST(request: Request) {
  // Each organization has its own ChatXFlow token in its own Settings tab, so running
  // under a tenant context is what picks the right sender for each batch.
  if (isCronCall(request)) {
    const organizations = await forEachActiveOrganization(() => sendPendingTaskReminders());
    return NextResponse.json({ scope: "all-organizations", organizations });
  }

  // The "Send Reminders Now" button only ever messages the admin's own team.
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const result = await sendPendingTaskReminders();
  return NextResponse.json({ scope: "organization", result });
}

// Vercel Cron sends a GET request to the scheduled path.
export async function GET(request: Request) {
  return POST(request);
}
