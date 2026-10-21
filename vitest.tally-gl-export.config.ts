import path from "node:path";
import { defineConfig } from "vitest/config";

// Standalone unit runner: db.select/listByOrg/getTenant are fully mocked here, so this
// must never pick up the default config's real-Postgres setupFiles/dotenv requirement.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/tally-gl-export.unit.test.ts"],
    setupFiles: [],
    globalSetup: [],
    env: { DATABASE_URL: "", NEON_DATABASE_URL: "" },
  },
});
