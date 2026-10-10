import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free: every persistence and provider boundary is mocked in the selected file.
export default defineConfig({
  test: { environment: "node", include: ["tests/stock-workflow-unit.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
