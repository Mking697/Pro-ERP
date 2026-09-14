/**
 * Shared CSV building for anything a browser downloads as a spreadsheet (analytics
 * export, the inventory bulk-import template, …) — one place to get formula-injection
 * defusing and Excel-friendly encoding right, instead of every export re-deriving it.
 */

/**
 * Escapes one CSV cell — quotes doubled, anything risky wrapped, and a formula defused.
 *
 * Excel and Sheets treat a cell beginning `=`, `+`, `-`, `@`, tab or carriage return as a
 * formula. Several of these exports carry text a user typed elsewhere in the app (a name,
 * a department, an item's Location), so `=cmd|'/c calc'!A1` or a `WEBSERVICE()` call would
 * execute on the machine of whoever opens the download. A leading apostrophe marks the
 * cell as text and stops that.
 *
 * Only strings are treated this way. A genuine number (a score, a quantity) would be
 * ruined by an apostrophe, and a real number can never be a formula.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return String(value);

  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a full CSV document (CRLF rows, UTF-8 BOM) from a grid of cells. */
export function buildCsv(rows: (string | number)[][]): string {
  const lines = rows.map((cols) => cols.map(csvCell).join(","));
  // CRLF and a UTF-8 BOM so Excel opens this cleanly, including non-ASCII text.
  return "﻿" + lines.join("\r\n");
}

/**
 * Parses a small CSV document into a grid of cells — handles quoted fields (embedded
 * commas, doubled quotes, embedded newlines) the way buildCsv() writes them. Not a
 * streaming parser; only meant for the kilobyte-sized files a person uploads by hand
 * (a filled-in import template), never for anything read back from an untrusted bulk
 * source at scale.
 */
export function parseCsv(text: string): string[][] {
  // Strip a UTF-8 BOM if present (buildCsv writes one, and Excel adds one on Save As).
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // Swallowed — the following "\n" (or end of input) is what closes the row, so a
      // lone "\r" (old Mac line endings) still closes it via the fallthrough below.
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // The file may or may not end with a trailing newline — flush whatever is left.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
