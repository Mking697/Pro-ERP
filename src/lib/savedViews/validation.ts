/**
 * Pure validation + serialization-shape helpers for "Saved Views/Filters", split out of
 * src/lib/savedViews.ts so this logic is testable without a database connection (that
 * file imports src/db/client.ts, which throws at import time without DATABASE_URL set —
 * see tests/saved-views.unit.test.ts, which only ever imports from here).
 */
export const SAVED_VIEW_MAX_NAME_LENGTH = 80;

export class SavedViewValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SavedViewValidationError";
  }
}

/** Trims and validates a saved view's module + name; throws `SavedViewValidationError`
 * (never returns an invalid value) so every caller — the API route and createSavedView()
 * alike — rejects the same inputs the same way. */
export function normalizeSavedViewInput(input: { module: string; name: string }): {
  module: string;
  name: string;
} {
  const moduleName = input.module.trim();
  if (!moduleName) {
    throw new SavedViewValidationError("Module zaroori hai.");
  }
  const name = input.name.trim();
  if (!name) {
    throw new SavedViewValidationError("View ka naam zaroori hai.");
  }
  if (name.length > SAVED_VIEW_MAX_NAME_LENGTH) {
    throw new SavedViewValidationError(
      `View ka naam ${SAVED_VIEW_MAX_NAME_LENGTH} characters se zyada nahi ho sakta.`
    );
  }
  return { module: moduleName, name };
}

/**
 * The save/load round trip this whole feature depends on: whatever a board's filters
 * object looks like, saving it (JSON-serialized into the `filters` jsonb column, see
 * src/db/schema/savedViews.ts) and loading it back must hand the caller back the exact
 * same shape it saved — no field silently dropped, reordered, or coerced. This models
 * that round trip without a real HTTP request/database (the API route's body is already
 * `JSON.stringify`'d by `fetch`, and Postgres's `jsonb` column round-trips a JSON value
 * byte-for-byte on read, so emulating both ends with `JSON.parse(JSON.stringify(...))` is
 * a faithful, DB-free stand-in for the real pipeline).
 */
export function roundTripFilters<T>(filters: T): T {
  return JSON.parse(JSON.stringify(filters)) as T;
}
