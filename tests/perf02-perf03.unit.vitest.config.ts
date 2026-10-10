import path from "node:path";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vitest/config";

// DB-free only: no dotenv/setup or real client is loaded.
export default defineConfig({
  plugins: [{
    name: "perf02-read-only-baseline-overlay",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("perf02-baseline/")) return path.resolve(__dirname, `${id.replace("/", "-")}.ts`);
    },
    load(id) {
      const name = path.basename(id).match(/^perf02-baseline-(inventory-service|inventory-ledger|accounts|account-ledger)\.ts$/)?.[1];
      if (!name) return;
      const files: Record<string, string> = {
        "inventory-service": "src/lib/inventory/service.ts",
        "inventory-ledger": "src/lib/inventory/ledger.ts",
        accounts: "src/lib/accounts/accounts.ts",
        "account-ledger": "src/lib/accounts/ledger.ts",
      };
      // Read-only overlay: NEVER restore/stash the shared worktree. Only report reads
      // are exercised; earlier admission/atomicity changes remain in real source.
      let source = execFileSync("git", ["show", `d79673041258ea324cff032d4aef23750200d43a:${files[name]}`], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
      if (name === "inventory-service") source = source.replaceAll('"@/lib/inventory/ledger"', '"perf02-baseline/inventory-ledger"');
      return source;
    },
  }],
  test: { environment: "node", include: ["tests/perf02-inventory-adc.unit.test.ts", "tests/perf02-perf03-reports.unit.test.ts"], setupFiles: [] },
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
});
