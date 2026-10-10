import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free: @/db/client is mocked in the test file itself.
export default defineConfig({
  test: { environment: "node", include: ["tests/health-readiness.unit.test.ts", "tests/migration-import-side-effects.unit.test.ts", "tests/check-migration-sync.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
