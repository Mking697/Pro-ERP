import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { generateDueRecurringOccurrences } from "@/lib/recurringGenerator";

/** Allows either an Admin session (manual trigger, for testing) or a valid CRON_SECRET
 * bearer token (Vercel Cron's automatic daily call) — same pattern as the WhatsApp reminders route. */
async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const guard = await requireRole(["Admin"]);
  return guard.ok;
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await generateDueRecurringOccurrences();
  return NextResponse.json(result);
}

// Vercel Cron sends a GET request to the scheduled path.
export async function GET(request: Request) {
  return POST(request);
}
