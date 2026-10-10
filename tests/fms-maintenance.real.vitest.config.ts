import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/fms-maintenance.real.test.ts"], setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
