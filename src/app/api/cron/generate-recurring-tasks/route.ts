import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { generateDueRecurringOccurrences } from "@/lib/recurringGenerator";
import { forEachActiveOrganization } from "@/lib/platform/runner";

// Walking every tenant sequentially takes longer than a single-org run ever did.
export const maxDuration = 60;

function isCronCall(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

export async function POST(request: Request) {
  // A scheduled run belongs to no logged-in user, so it generates for every organization.
  if (isCronCall(request)) {
    const organizations = await forEachActiveOrganization(() =>
      generateDueRecurringOccurrences()
    );
    return NextResponse.json({ scope: "all-organizations", organizations });
  }

  // A manual trigger runs only for the admin's own organization — their session is what
  // scopes it, so one customer can never kick off generation inside another's sheets.
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const result = await generateDueRecurringOccurrences();
  return NextResponse.json({ scope: "organization", result });
}

// Vercel Cron sends a GET request to the scheduled path.
export async function GET(request: Request) {
  return POST(request);
}
