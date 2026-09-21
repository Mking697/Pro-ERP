import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { generateDueRecurringOccurrences } from "@/lib/recurringGenerator";
import { processLeaveTransitions } from "@/lib/leave/reassignment";
import { forEachActiveOrganization } from "@/lib/platform/runner";

// Walking every tenant sequentially takes longer than a single-org run ever did.
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

/** Both are once-a-day, per-org, date-driven jobs — riding the same daily cron slot keeps
 * vercel.json's cron list from growing one entry per job. */
async function runDailyJobs() {
  const [recurring, leave] = await Promise.all([
    generateDueRecurringOccurrences(),
    processLeaveTransitions(),
  ]);
  return { recurring, leave };
}

export async function POST(request: Request) {
  // A scheduled run belongs to no logged-in user, so it generates for every organization.
  if (isCronCall(request)) {
    const organizations = await forEachActiveOrganization(() => runDailyJobs());
    return NextResponse.json({ scope: "all-organizations", organizations });
  }

  // A manual trigger runs only for the admin's own organization — their session is what
  // scopes it, so one customer can never kick off generation inside another org's data.
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const result = await runDailyJobs();
  return NextResponse.json({ scope: "organization", result });
}

// Vercel Cron sends a GET request to the scheduled path — and only Vercel Cron may use
// it. A session cookie is SameSite=Lax, which browsers *do* send on a cross-site top-level
// navigation, so aliasing GET straight to POST meant a crafted link an Admin merely
// clicked would fire recurring generation. The secret is
// required on this verb; the session-authenticated trigger stays POST-only.
export async function GET(request: Request) {
  if (!isCronCall(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return POST(request);
}
