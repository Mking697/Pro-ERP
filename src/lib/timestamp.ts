/**
 * One place that writes a timestamp, and one place that reads one back.
 *
 * Every audit timestamp in every sheet is stored as `DD/MM/YYYY HH:MM:SS` in India
 * Standard Time, because these sheets are read by people, not only by this app — an ISO
 * string like `2026-08-20T06:03:10.719Z` is both unreadable at a glance and in the wrong
 * timezone for everybody using the system.
 *
 * That format has two properties this file exists to contain:
 *
 *  - `new Date("20/08/2026 11:34:07")` does not parse. Anything comparing timestamps must
 *    go through `parseStamp`, never through `new Date` directly.
 *  - It does not sort as text: "05/09/2026" comes before "20/08/2026" alphabetically and
 *    that is the wrong order. Sorting must use `stampMs`, never `localeCompare`.
 *
 * `parseStamp` also accepts ISO, so rows written before this change keep working. A
 * customer's sheet is full of them and none of it is going to be rewritten.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `DD/MM/YYYY HH:MM:SS` in IST, for a Date. */
export function formatStamp(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  // Shift into IST and then read the UTC parts, so the result does not depend on
  // whatever timezone the server happens to run in.
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return (
    `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}` +
    ` ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())}`
  );
}

/** The current moment, ready to be written to a sheet. */
export function nowStamp(): string {
  return formatStamp(new Date());
}

const DMY = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Reads back anything this system may have written into a timestamp column.
 *
 * Handles the current `DD/MM/YYYY HH:MM:SS`, plain `DD/MM/YYYY`, the ISO strings written
 * before this change, and the `YYYY-MM-DDTHH:mm` shape that datetime inputs produce.
 * Returns null rather than an Invalid Date, so a caller cannot accidentally compare
 * against NaN and get silently false.
 */
export function parseStamp(value: string | undefined | null): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const m = DMY.exec(raw);
  if (m) {
    const [, d, mo, y, hh = "0", mm = "0", ss = "0"] = m;
    const ms =
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss)) -
      IST_OFFSET_MS;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Milliseconds for sorting and comparing.
 *
 * An unreadable value sorts last rather than throwing: a row with a damaged timestamp
 * should fall to the bottom of a list, not take the whole page down with it.
 */
export function stampMs(value: string | undefined | null): number {
  const parsed = parseStamp(value);
  return parsed ? parsed.getTime() : 0;
}

/** Newest first, for `Array.prototype.sort`. */
export function byNewest(a: string, b: string): number {
  return stampMs(b) - stampMs(a);
}

/** Oldest first — a running balance has to be added up in the order things happened. */
export function byOldest(a: string, b: string): number {
  return stampMs(a) - stampMs(b);
}
