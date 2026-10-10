import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/indent-ui-reconciliation.unit.test.ts"],
    setupFiles: [],
  },
});
