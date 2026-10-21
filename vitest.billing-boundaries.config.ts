import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit-only: no dotenv, global setup or database connection fallback.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  test: {
    environment: "node",
    include: ["tests/proxy-public-boundaries.unit.test.ts", "tests/health-readiness.unit.test.ts", "tests/billing-status-boundary.unit.test.ts", "tests/billing-checkout-mode.unit.test.ts", "tests/billing-subscription-access.unit.test.ts", "tests/billing-tenant-admission.unit.test.ts", "tests/billing-login-recovery.unit.test.ts", "tests/deleteOrganization-cascade-completeness.test.ts"],
  },
});
