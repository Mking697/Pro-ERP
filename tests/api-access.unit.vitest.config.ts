import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free: @/db/client is mocked in the test file itself (same pattern as
// tests/health-readiness.unit.vitest.config.ts / tests/dispatch-unit.vitest.config.ts).
export default defineConfig({
  test: { environment: "node", include: ["tests/api-access.unit.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
