import path from "node:path";
import { defineConfig } from "vitest/config";

// Client render/handler contracts only: no dotenv, database or browser setup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/ux03-ux04.unit.test.tsx"],
    setupFiles: [],
  },
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
