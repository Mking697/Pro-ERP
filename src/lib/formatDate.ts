/** Displays a stored "YYYY-MM-DDTHH:mm" value as "YYYY-MM-DD HH:mm" — safe on both server and client
 * since it's plain string formatting, not locale/timezone-dependent (avoids hydration mismatches). */
export function formatDueDisplay(value: string): string {
  if (!value) return "—";
  return value.replace("T", " ");
}
