import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in approved disposable PostgreSQL; never load the default dotenv setup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/user-admission-cap.real.test.ts"],
    setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
