import { formatStamp, parseStamp } from "@/lib/timestamp";

/**
 * Shows any stored date or timestamp as `DD/MM/YYYY HH:MM:SS` in IST.
 *
 * Goes through the shared parser, so a row written before the change (ISO) and one
 * written after (already IST) both display the same way — a list must not show two
 * different formats depending on when each row happened to be created.
 */
export function formatDueDisplay(value: string): string {
  if (!value) return "—";
  const parsed = parseStamp(value);
  return parsed ? formatStamp(parsed) : value;
}
