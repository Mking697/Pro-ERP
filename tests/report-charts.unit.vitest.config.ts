import path from "node:path";
import { defineConfig } from "vitest/config";

// Explicitly DB-free: never inherit application setup or credentials.
export default defineConfig({
  test: { environment: "node", setupFiles: [], include: ["tests/report-charts*.test.ts", "tests/report-charts*.test.tsx"] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
