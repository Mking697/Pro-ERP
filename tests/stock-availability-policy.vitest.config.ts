import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/stock-availability-policy.test.ts"],
    setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
