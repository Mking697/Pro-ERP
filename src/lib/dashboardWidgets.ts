/**
 * Simple dashboard widget customization (show/hide + up/down reorder, no drag-and-drop) —
 * see /dashboard's page.tsx for where each widget actually renders. Pure, client-safe
 * (no `@/lib/userSettings` / `@/lib/tenant` import here, deliberately): this file is
 * imported from customize-dashboard-dialog.tsx, a "use client" component, and that chain
 * must never pull in server-only code (next/headers via @/lib/tenant) into the browser
 * bundle — see src/lib/dashboardWidgetsStore.ts for the actual DB-backed read/write,
 * used only from Server Components/route handlers.
 *
 * Widget boundaries: five blocks, one per existing top-level sibling in the dashboard's
 * JSX — NOT one per visual card. `tabs` in particular stays a single widget even though
 * it contains several cards (Modules, Reports quick access, Guidebook, FMS Steps,
 * Upcoming Tasks, Recent Activity) and three whole tabs (Overview/Reports/Performance):
 * those live INSIDE one Tabs container today, not as independent page-level siblings, so
 * pulling any one of them out to reorder/hide on its own would change what a user who
 * has never touched this feature sees by default (e.g. Recent Activity currently only
 * ever renders while the Overview tab is selected — promoting it to an always-visible
 * top-level block would be a behavior change, which this feature must not cause for
 * untouched users). `onboarding` keeps its own existing auto-hide logic (Admin-only,
 * hidden once dismissed or once every step is done) — this toggle is an additional gate
 * on top of that, not a replacement for it.
 */
export type DashboardWidgetKey = "onboarding" | "quickNav" | "attention" | "stats" | "tabs";

export interface DashboardWidgetPref {
  key: DashboardWidgetKey;
  visible: boolean;
}

export interface DashboardWidgetDef {
  key: DashboardWidgetKey;
  // Deliberately not called `label` (see visibleNames in scripts/i18n-check.mjs) — a
  // `label`-named property is scanned as raw UI copy wherever it's defined, which would
  // require a growing scripts/i18n-baseline.json entry (explicitly frozen: "do not grow
  // this file") for a string that is actually translated where it's DISPLAYED
  // (customize-dashboard-dialog.tsx wraps it in `t(...)` there), not where it's defined.
  name: string;
}

/** Default order AND default visibility — exactly today's fixed layout. */
export const DASHBOARD_WIDGET_DEFS: readonly DashboardWidgetDef[] = [
  { key: "onboarding", name: "Shuru karein checklist" },
  { key: "quickNav", name: "Module shortcuts" },
  { key: "attention", name: "Dhyaan dene wali strip" },
  { key: "stats", name: "Stat cards" },
  { key: "tabs", name: "Reports & activity tabs" },
];

export const DASHBOARD_DEFAULT_PREFS: readonly DashboardWidgetPref[] = DASHBOARD_WIDGET_DEFS.map(
  (d) => ({ key: d.key, visible: true })
);

export const DASHBOARD_WIDGET_VALID_KEYS = new Set<string>(
  DASHBOARD_WIDGET_DEFS.map((d) => d.key)
);

/**
 * Reconciles a saved list against today's known widget set: unknown/removed keys are
 * dropped, any widget added to the app after the user last saved is appended at the end
 * (visible by default) rather than silently never appearing. A first-time user (no saved
 * row at all) gets the exact default order/visibility back, unchanged.
 */
export function reconcileDashboardWidgetPrefs(
  saved: DashboardWidgetPref[] | null
): DashboardWidgetPref[] {
  if (!saved || saved.length === 0) return [...DASHBOARD_DEFAULT_PREFS];

  const seen = new Set<string>();
  const kept: DashboardWidgetPref[] = [];
  for (const entry of saved) {
    if (
      entry &&
      typeof entry.key === "string" &&
      DASHBOARD_WIDGET_VALID_KEYS.has(entry.key) &&
      typeof entry.visible === "boolean" &&
      !seen.has(entry.key)
    ) {
      kept.push({ key: entry.key as DashboardWidgetKey, visible: entry.visible });
      seen.add(entry.key);
    }
  }
  for (const def of DASHBOARD_WIDGET_DEFS) {
    if (!seen.has(def.key)) kept.push({ key: def.key, visible: true });
  }
  return kept;
}
