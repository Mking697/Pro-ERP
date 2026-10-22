import { execFileSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Read-only differential harness: never stash/reset a sibling's work to prove RED.
// SECURITY_BASELINE=1 reruns desired assertions against the audited commit.
const baselineFiles = new Set([
  "src/lib/csv.ts", "src/lib/storage.ts", "src/app/api/blob/upload/route.ts",
  "src/lib/auth/apiKeyGuard.ts", "src/app/api/auth/login/route.ts",
  "src/lib/purchase/orders.ts", "src/lib/purchase/generalOrders.ts", "src/lib/leads/quotations.ts",
  "src/lib/currency/currency.ts", "src/lib/orders/orders.ts",
  ...["cancel", "credit-approve", "dispatch-commit", "payment-review", "stock-check"].map((action) => `src/app/api/orders/[orderId]/${action}/route.ts`),
]);
const root = path.resolve(__dirname, "..");
export default defineConfig({
  plugins: [{ name: "security-readonly-baseline", enforce: "pre", load(id) {
    const file = path.relative(root, id.split("?")[0]).replaceAll("\\", "/");
    if (process.env.SECURITY_BASELINE === "1" && baselineFiles.has(file)) {
      return execFileSync("git", ["show", `a34ff83:${file}`], { cwd: root, encoding: "utf8" });
    }
  } }],
  test: { environment: "node", include: ["tests/security-*.unit.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(root, "src") } },
});