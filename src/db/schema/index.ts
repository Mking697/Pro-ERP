/**
 * Re-exports every table (and enum) from every domain schema file — this is what
 * drizzle-kit's config points at, and what src/db/client.ts passes to `drizzle()` for
 * relational-query typing.
 */
export * from "./platform";
export * from "./auth";
export * from "./settings";
export * from "./tasks";
export * from "./inward";
export * from "./inventory";
export * from "./ppc";
export * from "./fms";
export * from "./leave";
export * from "./parties";
export * from "./purchase";
export * from "./leads";
