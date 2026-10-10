import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in approved disposable PostgreSQL; never load the default dotenv setup.
// OPS-03 regression guard: confirms runner.ts's switch to tenantFromOrgId() preserves
// forEachActiveOrganization()'s pre-existing tenant isolation and per-org error isolation
// guarantees under real concurrency.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/runner-concurrency.test.ts"],
    setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
