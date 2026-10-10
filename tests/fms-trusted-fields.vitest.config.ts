import path from "node:path";
import { defineConfig } from "vitest/config";

// Isolated mocked engine tests: no dotenv setup or live database imports.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/fms-trusted-fields.test.ts"],
    setupFiles: [],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
