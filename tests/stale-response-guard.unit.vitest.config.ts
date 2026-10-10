import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/stale-response-guard.unit.test.ts"], setupFiles: [], testTimeout: 10000 },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
