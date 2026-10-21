import { getUserSetting, upsertUserSetting } from "@/lib/userSettings";
import {
  DASHBOARD_DEFAULT_PREFS,
  reconcileDashboardWidgetPrefs,
  type DashboardWidgetPref,
} from "@/lib/dashboardWidgets";

/**
 * DB-backed read/write for dashboard widget prefs — split out of dashboardWidgets.ts
 * (which stays import-light/client-safe) because this half pulls in @/lib/userSettings
 * -> @/lib/tenant -> next/headers, server-only. Used only from /dashboard's page.tsx
 * (Server Component) and src/app/api/dashboard/widget-prefs/route.ts (Route Handler) —
 * never from the "use client" customize-dashboard-dialog.tsx.
 */
const PREFS_KEY = "DASHBOARD_WIDGETS";

export async function getDashboardWidgetPrefs(userId: string): Promise<DashboardWidgetPref[]> {
  const raw = await getUserSetting(userId, PREFS_KEY);
  if (!raw) return [...DASHBOARD_DEFAULT_PREFS];
  try {
    const parsed = JSON.parse(raw) as DashboardWidgetPref[];
    return reconcileDashboardWidgetPrefs(Array.isArray(parsed) ? parsed : null);
  } catch {
    return [...DASHBOARD_DEFAULT_PREFS];
  }
}

export async function saveDashboardWidgetPrefs(
  userId: string,
  prefs: DashboardWidgetPref[]
): Promise<void> {
  await upsertUserSetting(userId, PREFS_KEY, JSON.stringify(reconcileDashboardWidgetPrefs(prefs)));
}
