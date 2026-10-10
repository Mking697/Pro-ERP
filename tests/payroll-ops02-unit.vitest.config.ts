import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/payroll-statutory.test.ts",
      "tests/payroll-generate-finalize-unit.test.ts",
      "tests/payroll-shortfall-note.unit.test.ts",
    ],
    setupFiles: [],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
