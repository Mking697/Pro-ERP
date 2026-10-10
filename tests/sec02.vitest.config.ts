import path from "node:path";
import { defineConfig } from "vitest/config";

// Mocked share-route regressions only; never load the live-DB dotenv setup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/report-share-scope.test.ts"],
    setupFiles: [],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
