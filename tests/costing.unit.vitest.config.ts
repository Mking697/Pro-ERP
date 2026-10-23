import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", setupFiles: [], include: ["tests/costing-guide.test.ts", "tests/costing-engine.test.ts", "tests/costing-service.test.ts", "tests/costing-source.test.ts", "tests/costing-routes.test.ts", "tests/deleteOrganization-cascade-completeness.test.ts"] }, resolve: { alias: { "@": path.resolve(__dirname, "../src") } } });
