import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", setupFiles: [], include: ["tests/next-build-tracing.unit.test.ts", "tests/proxy-public-boundaries.unit.test.ts"] }, resolve: { alias: { "@": path.resolve(__dirname, "../src") } } });
