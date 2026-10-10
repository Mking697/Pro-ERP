import path from "node:path";
import { defineConfig } from "vitest/config";

// DB-free only: never load tests/setup.ts or dotenv.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/sec04-whatsapp-egress.test.ts", "tests/sec05-blob-tenant.test.ts"],
    setupFiles: [],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
