import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * DB-backed tests round-trip real HTTP calls to Neon — 30s covers a slow cold start
 * without letting a genuinely hung test block the suite forever.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
