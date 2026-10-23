import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", setupFiles: [], include: ["tests/job-costing-engine.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
