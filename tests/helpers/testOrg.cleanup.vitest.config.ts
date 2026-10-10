import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free logic tests for tests/helpers/testOrg.ts's batch-create/cleanup bookkeeping.
// @/lib/platform/registry is mocked in the test file itself, so no real database is
// touched; setupFiles is intentionally empty to skip tests/setup.ts's live-DB guard.
export default defineConfig({
  test: { environment: "node", include: ["tests/helpers/testOrg.cleanup.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
});
