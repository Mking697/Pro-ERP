import path from "node:path";
import { defineConfig } from "vitest/config";

// Client/grant tests only; never inherit real-DB setup or dotenv fallback.
export default defineConfig({
  test: { environment: "node", setupFiles: [], include: ["tests/costing-access.test.ts", "tests/costing-ui*.test.ts", "tests/costing-ui*.test.tsx"] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
