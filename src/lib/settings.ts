import { getSheetRows, appendSheetRow, updateSheetRow } from "@/lib/googleSheets";
import { cached, invalidateCache } from "@/lib/cache";

const SETTINGS_TAB = "Settings";
const SETTINGS_CACHE_KEY = "settings:all";
const SETTINGS_TTL_MS = 30_000;

/** Reads the whole "Settings" key-value tab from the root System sheet. */
export async function getAllSettings(): Promise<Record<string, string>> {
  return cached(SETTINGS_CACHE_KEY, SETTINGS_TTL_MS, async () => {
    const rows = await getSheetRows(SETTINGS_TAB);
    const map: Record<string, string> = {};
    for (const row of rows.slice(1)) {
      const [key, value] = row;
      if (key) map[key] = value ?? "";
    }
    return map;
  });
}

export async function getSetting(key: string): Promise<string | null> {
  const all = await getAllSettings();
  return all[key] ?? null;
}

/** Updates a key's row if it exists, otherwise appends a new one. */
export async function upsertSetting(key: string, value: string): Promise<void> {
  const rows = await getSheetRows(SETTINGS_TAB);
  const rowIndex = rows.findIndex((row, i) => i > 0 && row[0] === key);

  if (rowIndex === -1) {
    await appendSheetRow(SETTINGS_TAB, [key, value]);
  } else {
    await updateSheetRow(SETTINGS_TAB, rowIndex + 1, [key, value]);
  }

  invalidateCache(SETTINGS_CACHE_KEY);
}
