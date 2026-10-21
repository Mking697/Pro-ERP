import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free: every dependency the route touches is mocked per-test via vi.doMock.
export default defineConfig({
  test: { environment: "node", include: ["tests/api-v1-orders.unit.test.ts"], setupFiles: [], testTimeout: 30_000 },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
