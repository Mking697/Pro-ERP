import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { resolveRange } from "@/lib/analytics";
import { sendPerformanceReports } from "@/lib/reminders";

/** Sends every active, evaluated user their own MIS score + breakdown over WhatsApp — the
 * Team Performance page's "Send Report" button. Same `PERFORMANCE_VIEW` grant as the page
 * itself; nothing here reads a request body beyond the date range already on screen. */
export async function POST(request: Request) {
  const guard = await requireModule("PERFORMANCE_VIEW");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const range = resolveRange(
    url.searchParams.get("range") ?? "all",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined
  );

  const result = await sendPerformanceReports(range);
  return NextResponse.json(result);
}
