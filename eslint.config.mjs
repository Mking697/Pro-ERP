import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Isolated marketing/video workspace (own package.json/tsconfig where relevant) —
    // never part of the production app, must not affect its lint/build.
    "marketing/**",
    // Bundled third-party Agent Skills (installed via `npx skills add`) — their own
    // source trees, not part of this app, must not affect its lint/build.
    ".agents/**",
  ]),
]);

export default eslintConfig;
