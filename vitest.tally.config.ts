import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone unit runner: never merge the default DB/dotenv test configuration.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/tally-export.unit.test.ts"],
    setupFiles: [],
    globalSetup: [],
    env: { DATABASE_URL: "", NEON_DATABASE_URL: "" },
  },
});
