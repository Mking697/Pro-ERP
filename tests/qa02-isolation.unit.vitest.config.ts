import path from "node:path";
import { defineConfig } from "vitest/config";

// Only DB-free guard/helper regressions; never load dotenv or database setup.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [],
    include: ["tests/database-target-identity.test.ts", "tests/helpers/testOrg.cleanup.test.ts", "tests/runner-fixture-isolation.unit.test.ts", "tests/setup.guard.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
