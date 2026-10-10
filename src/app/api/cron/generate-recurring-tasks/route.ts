import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { generateDueRecurringOccurrences } from "@/lib/recurringGenerator";
import { processLeaveTransitions } from "@/lib/leave/reassignment";
import { forEachActiveOrganization } from "@/lib/platform/runner";
import { computeTenantUsageMetrics } from "@/lib/platform/usageMetrics";
import { logError } from "@/lib/errorLog";

// forEachActiveOrganization() now runs orgs through a bounded worker pool, not strictly
// sequentially — kept generous anyway since Vercel Cron's own timeout is separate from
// this, and a genuinely large org count still takes real wall-clock time even parallelized.
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

/** Both are once-a-day, per-org, date-driven jobs — riding the same daily cron slot keeps
 * vercel.json's cron list from growing one entry per job.
 *
 * Sequential, leave first, deliberately — not Promise.all. generateDueRecurringOccurrences()
 * resolves each new occurrence's assignee against *live* leave state (see
 * src/lib/leave/reassignment.ts's resolveActiveAssignee), so a leave whose start date is
 * today must already be activated before recurring generation runs today, or a task
 * generated today for a doer going on leave today would still be born on the absent doer
 * instead of their buddy — running the two concurrently left that outcome to scheduling
 * luck instead of guaranteeing it. */
async function runDailyJobs() {
  const leave = await processLeaveTransitions();
  const recurring = await generateDueRecurringOccurrences();
  return { recurring, leave };
}

export async function POST(request: Request) {
  // A scheduled run belongs to no logged-in user, so it generates for every organization.
  if (isCronCall(request)) {
    const organizations = await forEachActiveOrganization(() => runDailyJobs());
    // forEachActiveOrganization already isolates one org's failure from the rest, but
    // nothing was previously watching that result — a broken org's daily jobs could throw
    // every night with nobody noticing. Logged here so it shows up at /platform instead.
    for (const org of organizations) {
      if (!org.ok) {
        await logError({
          orgId: org.orgId,
          routePath: "cron:generate-recurring-tasks",
          message: org.error ?? "Unknown error",
        });
      }
    }

    // Its own cross-org aggregation (computed once, not once per org — see the doc comment
    // on computeTenantUsageMetrics()), so this runs separately from runDailyJobs() above
    // rather than nested inside forEachActiveOrganization's own per-org loop.
    const usage = await computeTenantUsageMetrics().catch(async (error) => {
      await logError({
        orgId: "",
        routePath: "cron:tenant-usage-metrics",
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
    for (const org of usage) {
      if (!org.ok) {
        await logError({
          orgId: org.orgId,
          routePath: "cron:tenant-usage-metrics",
          message: org.error ?? "Unknown error",
        });
      }
    }

    return NextResponse.json({ scope: "all-organizations", organizations, usage });
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
