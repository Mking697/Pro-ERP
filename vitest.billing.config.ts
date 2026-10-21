import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", setupFiles: [], include: ["tests/billing-subscription.unit.test.ts", "tests/billing-webhook.unit.test.ts", "tests/billing-provider.unit.test.ts", "tests/billing-routes.unit.test.ts", "tests/billing-standard.unit.test.ts"] },
  resolve: { alias: [ { find: "@/db/client", replacement: path.resolve(__dirname, "tests/billing-db-forbidden.ts") }, { find: "@", replacement: path.resolve(__dirname, "src") } ] },
});
