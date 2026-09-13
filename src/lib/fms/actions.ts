/**
 * Types and JSON-safe (de)serializers for an FMS step's Action — what happens on a
 * particular outcome. Pure, no server imports, same shape as src/lib/fms/dataSource.ts.
 *
 * Only one action type exists today: writing a Stock Ledger movement. Field references
 * (`skuField`/`qtyField`/`uomField`) are keys into whatever that step's Data Source
 * resolved (its own Form fields, or pulled Existing-FMS columns) — the template builder
 * UI only ever offers these as a dropdown, never a free-typed name, so a typo can't
 * silently wire up the wrong movement.
 */

export type ActionType = "" | "LEDGER_MOVEMENT";

export interface LedgerMovementOutcomeAction {
  direction: "In" | "Out";
  skuField: string;
  qtyField: string;
  /** Falls back to the resolved Item's own UOM when omitted. */
  uomField?: string;
}

/** Keyed by outcome — an outcome with no entry (or `null`) does nothing. */
export type LedgerMovementActionConfig = Record<string, LedgerMovementOutcomeAction | null>;

export function parseActionType(raw: string | undefined | null): ActionType {
  return raw === "LEDGER_MOVEMENT" ? raw : "";
}

export function parseLedgerMovementActionConfig(
  raw: string | undefined | null
): LedgerMovementActionConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function serializeActionConfig(config: LedgerMovementActionConfig): string {
  return JSON.stringify(config);
}
