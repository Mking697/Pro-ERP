import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["tests/finance-atomicity.test.ts"], setupFiles: [path.resolve(__dirname, "local-isolated/setup.ts")], testTimeout: 20000, hookTimeout: 20000 },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
