/** Accepts a full Google Sheets URL or a bare spreadsheet ID. */
export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/** Extracts the tab's gid from a URL like ".../edit#gid=123456", if present. */
export function extractGid(input: string): number | null {
  const match = input.match(/[#&]gid=(\d+)/);
  return match ? Number(match[1]) : null;
}

/** Accepts a full Drive folder URL ("/folders/<ID>") or a bare folder ID. */
export function extractDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9-_]{10,}$/.test(trimmed)) return trimmed;
  return null;
}
