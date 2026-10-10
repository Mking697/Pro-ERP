import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free only: no default setup (which loads .env.local).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/perf06-gemini-deadline.unit.test.ts", "tests/perf06-whatsapp-budget.unit.test.ts", "tests/perf06-reminder-batch.unit.test.ts", "tests/perf04-search-sql.unit.test.ts", "tests/perf04-palette.unit.test.tsx", "tests/perf04-report-pushdown.unit.test.ts", "tests/perf04-analytics-integration.unit.test.tsx", "tests/perf04-performance-page.unit.test.ts", "tests/perf06-config-query-count.unit.test.ts", "tests/perf04-other-reports.unit.test.ts"],
    setupFiles: [],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
