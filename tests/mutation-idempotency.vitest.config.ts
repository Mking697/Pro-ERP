import path from "node:path";
import { defineConfig } from "vitest/config";

// Explicit disposable DB setup; no default dotenv or production credentials.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/mutation-idempotency.test.ts"],
    setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});