import { NextResponse } from "next/server";
import { dispatchNotifications } from "@/lib/notifications/dispatch";

// Same shape/cost as dispatch-webhooks's own cron — one poll cycle processes every org's
// pending notifiable events once; meant to be hit every 1-2 minutes, not run long itself.
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

/**
 * Notification dispatch poller — same `CRON_SECRET` bearer-header pattern as
 * src/app/api/cron/dispatch-webhooks/route.ts. NOT wired into vercel.json's own cron
 * schedule (Vercel Cron's minimum interval on this project's plan tier is daily; this job
 * needs to run every 1-2 minutes) — instead this needs its OWN new system-cron entry on
 * the VPS:
 *
 *   * * * * * curl -s -X POST -H "Authorization: Bearer ***" \
 *     https://<your-domain>/api/cron/dispatch-notifications
 *
 * (every 1-2 minutes; adjust the leading "*" to "star-slash-2" for every-2-minutes).
 * This route only ever calls `dispatchNotifications()` — no per-org session, no org loop
 * of its own, since that function already walks every active org itself.
 */
export async function POST(request: Request) {
  if (!isCronCall(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const result = await dispatchNotifications();
  return NextResponse.json({ organizations: result });
}

// Mirrors dispatch-webhooks/route.ts's own GET aliasing for cron providers that only
// issue GET — still gated by the same secret check.
export async function GET(request: Request) {
  if (!isCronCall(request)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return POST(request);
}
