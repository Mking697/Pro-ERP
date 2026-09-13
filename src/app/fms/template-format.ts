/**
 * Client-safe copies of the tiny parsing helpers in src/lib/fms/templates.ts — duplicated
 * rather than imported, since that file pulls in server-only Sheets code that must never
 * reach the browser bundle.
 */

export function parseOutcomeOptions(raw: string): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseNextStepMap(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!raw) return map;
  for (const pair of raw.split(";")) {
    const [outcome, target] = pair.split(":");
    if (outcome?.trim() && target?.trim()) map[outcome.trim()] = target.trim();
  }
  return map;
}
