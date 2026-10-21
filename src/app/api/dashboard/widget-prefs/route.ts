import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { DASHBOARD_WIDGET_DEFS, type DashboardWidgetKey, type DashboardWidgetPref } from "@/lib/dashboardWidgets";
import { saveDashboardWidgetPrefs } from "@/lib/dashboardWidgetsStore";

const VALID_KEYS = new Set<string>(DASHBOARD_WIDGET_DEFS.map((d) => d.key));

/** Any logged-in user may save their own dashboard layout — this is a personal
 * preference, not an org-wide setting, so there is no role check here (unlike
 * /api/onboarding/dismiss, which really is Admin-only). */
export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const prefs = body?.prefs;
  if (!Array.isArray(prefs) || prefs.length === 0) {
    return NextResponse.json({ error: "Widget list khaali nahi ho sakti." }, { status: 400 });
  }

  const seen = new Set<string>();
  const cleaned: DashboardWidgetPref[] = [];
  for (const entry of prefs) {
    if (
      !entry ||
      typeof entry.key !== "string" ||
      !VALID_KEYS.has(entry.key) ||
      typeof entry.visible !== "boolean" ||
      seen.has(entry.key)
    ) {
      return NextResponse.json({ error: "Widget list invalid hai." }, { status: 400 });
    }
    seen.add(entry.key);
    cleaned.push({ key: entry.key as DashboardWidgetKey, visible: entry.visible });
  }
  if (seen.size !== VALID_KEYS.size) {
    return NextResponse.json({ error: "Widget list incomplete hai." }, { status: 400 });
  }

  await saveDashboardWidgetPrefs(guard.session.userId, cleaned);

  return NextResponse.json({ success: true });
}
