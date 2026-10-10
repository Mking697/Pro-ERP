import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free logic test for the fail-fast DATABASE_URL target guard used by tests/setup.ts.
// No real database involved; setupFiles is intentionally empty so tests/setup.ts's own
// side-effecting guard never runs as part of this config.
export default defineConfig({
  test: { environment: "node", include: ["tests/setup.guard.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
