import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/replay-recovery-api.unit.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
