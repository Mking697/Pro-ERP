/**
 * Pure matching helpers shared by every camera-scan integration (Inventory, Dispatch,
 * Purchase General PO Receive). The decoded barcode/QR payload is always just a SKU —
 * there is no separate barcode field anywhere in the schema (see AGENTS/task notes) —
 * so every caller is really doing the same "does this scanned text identify one of my
 * known rows" lookup, trimmed and case-insensitively (label printers/phone cameras can
 * add surrounding whitespace, and operators may key SKUs in with inconsistent case).
 */

/** Trims a decoded scan payload. Kept as a named step (not inlined) so every match
 * function normalizes identically — a future scanner library swap only touches this. */
export function normalizeScanValue(value: string): string {
  return value.trim();
}

/** A single candidate row a scan can land on: one id, one or more lookup strings
 * (a General PO line has no real SKU field, so it offers both its free-text
 * `description` and `particular` as candidates — see generalOrders.ts's own comment). */
export interface ScannableRow {
  id: string;
  candidates: string[];
}

/** Finds the first row whose some candidate string equals the scanned value
 * (trimmed, case-insensitive exact match — never a substring match, so a scan can
 * never silently land on the wrong SKU because one happens to contain another). */
export function matchRowByScan(rows: ScannableRow[], scanned: string): ScannableRow | null {
  const needle = normalizeScanValue(scanned).toLowerCase();
  if (!needle) return null;
  return rows.find((row) => row.candidates.some((c) => c.trim().toLowerCase() === needle)) ?? null;
}

/** Convenience wrapper for the common case of matching a flat list of SKUs
 * (Inventory board, Dispatch checklist) instead of multi-candidate rows. */
export function matchSkuByScan(skus: string[], scanned: string): string | null {
  const row = matchRowByScan(skus.map((sku) => ({ id: sku, candidates: [sku] })), scanned);
  return row?.id ?? null;
}

/** De-duplicated list of SKUs a checklist (e.g. Dispatch scan-to-verify) must cover —
 * a shipment can carry the same SKU across more than one line, and the checklist is
 * about the *item* being verified at least once, not about ticking every line. */
export function uniqueSkus(skus: string[]): string[] {
  return [...new Set(skus)];
}

/** True once every required SKU has been scanned/ticked at least once. */
export function isChecklistComplete(required: string[], scanned: ReadonlySet<string>): boolean {
  return required.length > 0 && required.every((sku) => scanned.has(sku));
}
