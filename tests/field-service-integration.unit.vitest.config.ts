import path from "node:path";
import { defineConfig } from "vitest/config";

// Schema reflection and packaged migration checks: no live database or dotenv.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: [],
    include: ["tests/deleteOrganization-cascade-completeness.test.ts", "tests/health-readiness.unit.test.ts", "tests/migration-import-side-effects.unit.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
