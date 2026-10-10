import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/orders-domain.real.test.ts"],
    setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});