import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in approved disposable PostgreSQL; never load the default dotenv setup.
// OPS-03 regression guard: confirms updateUser()'s reactivate-path cap admission change
// did not disturb the pre-existing last-Active-Admin atomic guard (demote/deactivate/
// delete), including its own real-driver concurrency proof.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/last-admin-guard.test.ts"],
    setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
