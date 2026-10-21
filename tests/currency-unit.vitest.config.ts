import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free: @/db/client and @/lib/tenant are mocked in the test file itself (same pattern
// as tests/dispatch-domain.test.ts).
export default defineConfig({
  test: { environment: "node", include: ["tests/currency-unit.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
