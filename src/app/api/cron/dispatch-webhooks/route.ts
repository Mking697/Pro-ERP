import { NextResponse } from "next/server";
import { dispatchPendingWebhooks } from "@/lib/apiAccess/webhooks";

// Short — one poll cycle processes every org's active subscriptions once; this cron is
// meant to be hit every 1-2 minutes, not to run long itself.
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

/**
 * Webhook delivery poller — same `CRON_SECRET` bearer-header pattern as
 * src/app/api/cron/generate-recurring-tasks/route.ts's own `isCronCall()`. NOT wired into
 * vercel.json's own cron schedule (Vercel Cron's minimum interval is daily on this
 * project's plan tier historically used for other jobs here; this job needs to run every
 * 1-2 minutes) — instead this needs a NEW system-cron entry on the VPS:
 *
 *   * * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *     https://<your-domain>/api/cron/dispatch-webhooks
 *
 * (every 1-2 minutes; adjust the leading "*" to "star-slash-2" for every-2-minutes).
 * This route only ever calls `dispatchPendingWebhooks()` — no per-org session, no org
 * loop of its own, since that function already walks every org's active subscriptions.
 */
export async function POST(request: Request) {
  if (!isCronCall(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const result = await dispatchPendingWebhooks();
  return NextResponse.json(result);
}

// Mirrors generate-recurring-tasks/route.ts's own GET aliasing for actual cron providers
// that only issue GET — still gated by the same secret check, so no SameSite cookie
// navigation can ever trigger this.
export async function GET(request: Request) {
  if (!isCronCall(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return POST(request);
}
