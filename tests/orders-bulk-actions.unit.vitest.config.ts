import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free: bulkAdvanceActionFor()/bulkCancelAllowed() are pure functions over OrderRow[]
// (see src/app/orders/orders-board.tsx) — no network/db/React rendering involved.
export default defineConfig({
  test: { environment: "node", include: ["tests/orders-bulk-actions.unit.test.ts"], setupFiles: [], testTimeout: 30_000 },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
