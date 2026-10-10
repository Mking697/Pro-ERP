import path from "node:path";
import { defineConfig } from "vitest/config";

// Isolated security regressions: never run the live-DB dotenv setup.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live-session*.test.ts", "tests/chatbot-request-context.test.ts"],
    setupFiles: [],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
