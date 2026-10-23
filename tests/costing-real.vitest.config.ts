import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", setupFiles: ["tests/costing-real.setup.ts"], include: ["tests/costing-real.test.ts"], fileParallelism: false, testTimeout: 30000 }, resolve: { alias: { "@": path.resolve(__dirname, "../src") } } });
