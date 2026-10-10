import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", setupFiles: [], include: ["tests/perf01-perf05.*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
